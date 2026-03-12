# YT Subtitle Grabber v8

Bản nâng cấp này giữ nguyên lõi popup workspace nhưng sửa đúng các điểm đang gây khó chịu khi dùng thật.

## Nâng cấp chính

- **Ưu tiên phụ đề gốc của video** khi đọc metadata, thay vì dễ bị lệch theo track đang bật trên player.
- Thêm tùy chọn **tự tải lại khi đổi source / target / mode** để chuyển ngôn ngữ nhanh hơn.
- Hiển thị rõ trong popup:
  - ngôn ngữ gốc
  - track đang chọn
  - lý do chọn mặc định
- Giữ nguyên các tính năng đang có:
  - original / translated / bilingual
  - cleaned transcript
  - copy / export TXT, SRT, VTT
  - history
  - search
  - range export

## Ghi chú kiến trúc

Popup hiện tại đã tự chạy trực tiếp bằng `chrome.scripting.executeScript(..., { world: "MAIN" })`, nên các file `content.js`, `page-bridge.js`, `background.js` trong gói hiện tại chỉ còn là phần code cũ để tham khảo, không phải luồng runtime chính.