# YT Subtitle Grabber v2

Bản nâng cấp của extension lấy phụ đề YouTube.

## Điểm cải thiện

- Không còn gọi `response.json()` trực tiếp trên response rỗng.
- Thử nhiều định dạng phụ đề: JSON3, XML/TTML, VTT.
- Fetch ngay trong ngữ cảnh trang YouTube để tận dụng first-party cookies.
- Dò thêm các request `timedtext` thật từ `performance` để bắt các URL đang được player dùng.
- Có bảng **Chẩn đoán** để xem từng lần thử tải.

## Cài đặt

1. Giải nén thư mục này.
2. Mở `chrome://extensions/`
3. Bật **Developer mode**.
4. Chọn **Load unpacked**.
5. Trỏ tới thư mục `yt-subtitle-extension-v2`.

## Cách dùng

1. Mở một video YouTube có phụ đề.
2. Nếu cần, bật nút **CC** trên player trước.
3. Bấm icon extension.
4. Chọn track ngôn ngữ.
5. Tải TXT / SRT / VTT hoặc sao chép nội dung.
6. Nếu lỗi, mở mục **Chẩn đoán** trong popup để xem URL nào đang trả rỗng.