# YT Subtitle Grabber v3

Bản v3 được tách theo kiến trúc rõ ràng hơn:

- `background.js`: xử lý tải file và service worker.
- `content.js`: giao tiếp với trang YouTube và fallback transcript panel.
- `page-bridge.js`: chạy ở MAIN world để đọc `ytInitialPlayerResponse`, gọi player API và fetch timedtext.
- `popup.js`: UI của extension.

## Điểm nâng cấp

- Không còn phụ thuộc hoàn toàn vào `response.json()`.
- Có 2 lớp lấy phụ đề:
  1. timedtext / player metadata
  2. transcript panel fallback
- Tách logic rõ hơn nên dễ sửa khi YouTube thay đổi.
- Download đi qua background service worker.

## Cài đặt

1. Giải nén thư mục này.
2. Mở `chrome://extensions/`
3. Bật **Developer mode**.
4. Chọn **Load unpacked**.
5. Trỏ tới thư mục `yt-subtitle-extension-v3`.

## Cách dùng

1. Mở một video YouTube có phụ đề.
2. Bấm icon extension.
3. Chọn track.
4. Nếu timedtext thất bại, bấm **Thử transcript panel** hoặc tự mở transcript panel trên YouTube rồi thử lại.

## Lưu ý

- Transcript panel fallback là best-effort vì YouTube thay đổi DOM khá thường xuyên.
- Với vài video, panel transcript chỉ hiện khi YouTube thực sự hỗ trợ transcript trên giao diện hiện tại.