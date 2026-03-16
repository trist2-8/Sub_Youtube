# Subtitle Grabber

Chrome extension để lấy, xem và xuất subtitle từ YouTube, đồng thời có nhánh fallback cho Netflix.

## Bản 4.1.0
- sửa lỗi recursion làm hỏng popup chính ở bản 4.0.0
- tách riêng cửa sổ ghim sang `pinned.html`
- cải thiện sync YouTube theo kiểu low-latency an toàn hơn
- giữ fallback Netflix bằng `textTracks` và `live capture`

## Cách dùng
1. Mở `chrome://extensions`
2. Bật Developer mode
3. Chọn **Load unpacked** và trỏ tới thư mục này
4. Mở video YouTube hoặc Netflix rồi dùng popup extension
5. Bấm nút ghim để mở cửa sổ theo dõi subtitle riêng

## Ghi chú
- Netflix không phải title nào cũng expose full subtitle track cho extension.
- Khi Netflix không lộ full track, extension sẽ thử live capture subtitle đang hiển thị trên màn hình.
