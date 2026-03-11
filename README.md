# YT Subtitle Grabber v5

Bản v5 là bước nâng cấp đầu tiên theo hướng trải nghiệm dùng thật tốt hơn, thay vì cố thêm nhiều fallback phức tạp.

## Mới trong v5

- Vẫn ưu tiên lấy **phụ đề gốc** trước.
- Thêm **3 chế độ hiển thị / xuất file**:
  - Chỉ phụ đề gốc
  - Chỉ bản dịch
  - Song ngữ
- Thêm **làm sạch nội dung**:
  - Gộp dòng trùng lặp liên tiếp
  - Gộp câu ngắn liền nhau
- **Ghi nhớ cài đặt** bằng `chrome.storage.local`:
  - Kiểu hiển thị
  - Tùy chọn làm sạch
  - Ngôn ngữ đầu ra gần nhất
- Bỏ hẳn các tầng `content.js / background.js / transcript panel` khỏi luồng chính; popup chạy trực tiếp bằng `chrome.scripting.executeScript(..., { world: "MAIN" })`.

## Lưu ý quan trọng

- Phụ đề gốc thường ổn định hơn bản dịch.
- Bản dịch vẫn dùng auto-translate của chính YouTube, nên có video được và có video không.
- Nếu video có cả English gốc và Vietnamese gốc thật sự, hãy chọn trực tiếp ở ô **Phụ đề gốc** và để **Ngôn ngữ đầu ra** là **Giữ nguyên phụ đề gốc đã chọn**.

## Cài đặt

1. Giải nén thư mục này.
2. Mở `chrome://extensions/`
3. Bật Developer mode.
4. Chọn Load unpacked.
5. Trỏ tới thư mục `yt-subtitle-extension-v5`.
6. Reload extension rồi refresh lại tab YouTube một lần.