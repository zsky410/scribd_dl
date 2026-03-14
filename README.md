# scribd_dl

Tiện ích Chrome (Manifest V3) giúp **tải file PDF từ link Scribd** một cách gần như tự động và âm thầm:

- **Cách dùng**
  - Cài extension vào Chrome.
  - Mở trang tài liệu Scribd (hoặc copy link).
  - Mở popup extension, dán link Scribd (nếu chưa tự nhận), bấm **Tải PDF**.
  - Đợi vài giây, file PDF sẽ được lưu vào thư mục tải xuống mặc định của trình duyệt.

- **Cách hoạt động (tóm tắt)**
  - Extension lấy `docId` từ URL Scribd.
  - Mở một tab embed ẩn, tự động scroll để tải hết nội dung.
  - Dọn dẹp quảng cáo/overlay.
  - Dùng Chrome DevTools Protocol (`Page.printToPDF`) để xuất trực tiếp thành PDF và tải xuống.

- **Code flow chi tiết**
  - `manifest.json`
    - `manifest_version: 3`, khai báo `action` dùng `popup.html`.
    - `background.service_worker: "background.js"`: toàn bộ flow chạy ở background, không phụ thuộc popup mở/đóng.
    - `permissions`: `tabs`, `scripting`, `downloads`, `debugger` để:
      - tạo tab mới, inject script vào tab (`scripting`),
      - điều khiển in PDF qua DevTools Protocol (`debugger`),
      - tải file về máy (`downloads`).
    - `host_permissions: ["https://www.scribd.com/*"]` cho phép inject script vào trang Scribd.
  - `popup.html` + `popup.js`
    - UI tối giản:
      - 1 ô nhập `Link tài liệu Scribd`.
      - Nút **Tải PDF**.
      - 1 khối thông báo trạng thái (đang xử lý / thành công / lỗi).
    - Logic chính:
      - Regex `SCRIBD_PATTERN` bắt `docId` từ URL dạng `scribd.com/document/<ID>/...`.
      - Tự phát hiện nếu tab hiện tại đang mở Scribd, cho phép **auto điền URL**.
      - Khi bấm **Tải PDF**:
        - Gửi message tới background:  
          `{ action: "startDownload", config: { docId } }`.
        - Bật polling `getState` để nhận trạng thái hiện tại và update thông báo (`Đang xử lý...`, `Đang tải xuống...`, `Đã lưu: ...`).
  - `background.js` – trái tim của extension
    - Giữ một object `jobState`:
      - `running`, `step`, `progress`, `message`, `type`, `tabId`.
      - Cho phép popup đọc trạng thái qua `action: "getState"`.
    - Khi nhận `action: "startDownload"`:
      - Nếu đang chạy job khác → trả về lỗi `Đang xử lý một tài liệu khác`.
      - Gọi `startDownloadJob(config)` (không block popup).
    - Hàm `startDownloadJob({ docId })`:
      1. **Mở trang embed**
         - Build URL: `https://www.scribd.com/embeds/${docId}/content`.
         - `chrome.tabs.create({ url: embedUrl, active: true })`.
         - `waitForTabLoad(tabId)` chờ `tab.status === "complete"`.
         - `sleep(3000)` cho Scribd render nội dung.
      2. **Scroll để load hết trang**
         - Gọi `execScript(tabId, injectedQuickScroll)`.
         - `injectedQuickScroll` chạy trong context trang:
           - Tìm container cuộn (`.document_scroller` hoặc `document.scrollingElement`).
           - Tạo vòng lặp `tick()`:
             - Mỗi bước tăng `scrollTop` một đoạn bằng ~80% chiều cao viewport.
             - Cập nhật `window.__scrollStatus = { progress, done }`.
             - Khi chạm đáy: trả lại `scrollTop = 0`, đặt `done = true`.
         - Background dùng `pollScrollDone(tabId)`:
           - Định kỳ inject hàm anonymous đọc `window.__scrollStatus`.
           - Cập nhật `jobState.message = "Đang xử lý... XX%"`.
           - Khi `done === true` → chuyển bước tiếp theo.
      3. **Dọn dẹp DOM / chuẩn bị in**
         - Gọi `execScript(tabId, injectedCleanDOM)`:
           - Xóa class `document_scroller` (giữ element, chỉ bỏ class + overflow).
           - Xóa các overlay: `toolbar_drop`, `mobile_overlay`, `promo`, `ads`, blur...
           - Đặt `overflow: visible` cho `.text_layer`, `.page`, `.outer_page`.
           - Đo kích thước trang đầu tiên (`.outer_page` / `.page`) bằng `getBoundingClientRect`.
           - Inject thêm `<style>` với:
             - `@page { size: <width>px <height>px; margin: 0; }`
             - `@media print { ... }` để:
               - Mỗi trang tương ứng đúng 1 trang PDF.
               - Tránh trang trắng / page-break sai vị trí.
      4. **Lấy kích thước trang chính xác**
         - Gọi `execScript(tabId, injectedGetPageDimensions)`:
           - Trả về `{ width, height }` (px) nếu đo được.
      5. **Gọi `Page.printToPDF` qua DevTools Protocol**
         - Hàm `printToPdf(tabId, dims)`:
           - `chrome.debugger.attach({ tabId }, "1.3", ...)`.
           - Build `pdfOpts`:
             - Nếu có `dims`:
               - `paperWidth = width / 96`, `paperHeight = height / 96` (đơn vị inch).
               - `preferCSSPageSize = false` (dùng kích thước custom).
             - Nếu không: fallback dùng `preferCSSPageSize = true`.
           - `chrome.debugger.sendCommand("Page.printToPDF", pdfOpts)` → nhận `result.data` (base64 PDF).
           - `chrome.debugger.detach(...)`.
      6. **Tải file PDF về máy**
         - Ghép `dataUrl = "data:application/pdf;base64," + pdfBase64`.
         - Gọi `chrome.downloads.download({ url: dataUrl, filename, saveAs: false })`.
         - Dùng `chrome.downloads.search({ id })` để đọc lại đường dẫn thực tế (absolute path) và hiển thị cho user:  
           `Đã lưu: /path/to/Downloads/scribd_<docId>.pdf`.
      7. **Dọn dẹp**
         - Đóng tab embed bằng `chrome.tabs.remove(tabId)`.
         - Cập nhật `jobState` sang `done` + `type: "success"`.

- **Lưu ý**
  - Chỉ nên dùng cho mục đích **học tập / cá nhân**.
  - Tôn trọng bản quyền của tác giả và nền tảng Scribd.

