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

- **Lưu ý**
  - Chỉ nên dùng cho mục đích **học tập / cá nhân**.
  - Tôn trọng bản quyền của tác giả và nền tảng Scribd.

