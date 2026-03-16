# Subtitle Grabber

Chrome extension để lấy, xem và xuất subtitle từ YouTube, đồng thời có nhánh fallback cho Netflix.

## Bản 4.2.0
- sửa lỗi pin YouTube bị hỏng khi `response.json()` gặp timedtext rỗng hoặc không phải JSON hợp lệ
- thiết kế lại cửa sổ ghim theo kiểu gọn hơn, tập trung vào câu hiện tại + review log đang chạy
- review log của pin sẽ giữ lại toàn bộ các dòng live capture Netflix thay vì hiện rồi mất
- pin tự chạy độc lập, có auto retry nhẹ khi tab đổi hoặc lúc chưa lấy được subtitle
- giảm kích thước cửa sổ ghim để tiện theo dõi khi đang xem video

## Cách dùng
1. Mở `chrome://extensions`
2. Bật Developer mode
3. Chọn **Load unpacked** và trỏ tới thư mục này
4. Mở video YouTube hoặc Netflix rồi dùng popup extension
5. Bấm nút ghim để mở cửa sổ theo dõi subtitle riêng

## Ghi chú
- Netflix không phải title nào cũng expose full subtitle track cho extension.
- Khi Netflix không lộ full track, extension sẽ thử live capture subtitle đang hiển thị trên màn hình và giữ review log trong cửa sổ ghim.
- Với YouTube, pin sẽ ưu tiên timedtext `json3`, sau đó fallback sang `vtt` hoặc XML để tránh lỗi parse JSON.
