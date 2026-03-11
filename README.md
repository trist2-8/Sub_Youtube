# YT Subtitle Grabber v4

Bản v4 bỏ hẳn content script / background phức tạp và chạy trực tiếp từ popup bằng
`chrome.scripting.executeScript(..., { world: "MAIN" })`, nên tránh được lỗi:

- Could not establish connection
- Receiving end does not exist

## Điểm chính

- Ưu tiên phụ đề gốc.
- Tách riêng:
  - Phụ đề gốc
  - Ngôn ngữ đầu ra
- Tự cố chọn phụ đề đang bật trên player nếu đọc được.
- Dịch vẫn là best-effort từ YouTube auto-translate (`tlang`), không thể bảo đảm mọi video.

## Cài đặt

1. Giải nén thư mục này.
2. Mở `chrome://extensions/`
3. Bật Developer mode.
4. Chọn Load unpacked.
5. Trỏ tới thư mục `yt-subtitle-extension-v4`.
6. Sau khi reload extension, refresh lại tab YouTube một lần.

## Khi nào dùng “Giữ nguyên phụ đề gốc đã chọn”

- Khi video có nhiều phụ đề gốc thật sự, ví dụ English và Vietnamese.
- Khi YouTube auto-translate trả rỗng.