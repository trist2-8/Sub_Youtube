# UPDATE LOG 4.9.0

## Mục tiêu
Nâng cấp cửa sổ pin để người dùng có thể theo dõi toàn bộ subtitle từ đầu đến cuối thay vì chỉ xem câu đang phát.

## Đã cập nhật
- Làm mới toàn bộ `pinned.html` và `pinned.css` theo layout mới: phần current cue ở trên, transcript đầy đủ ở dưới.
- Viết lại `pinned.js` để:
  - tải full transcript YouTube và hiển thị toàn bộ cue
  - parse timedtext YouTube an toàn hơn bằng nhiều định dạng: `json3`, `srv3`, `vtt`, XML mặc định
  - giữ lại toàn bộ lịch sử `live capture` của Netflix theo phiên
  - hiển thị danh sách subtitle có timestamp và hỗ trợ click để seek video
  - tự highlight câu đang phát và auto-scroll theo active cue
  - copy toàn bộ transcript từ cửa sổ pin
- Tăng version lên `4.9.0`.

## Kết quả mong đợi
- Pin YouTube không còn chỉ hiện 1 câu hiện tại; có thể xem toàn bộ subtitle từ đầu đến cuối.
- Pin Netflix nếu có full track sẽ hiển thị toàn bộ cue; nếu chỉ live capture thì sẽ tích lũy toàn bộ câu kể từ lúc pin bắt đầu chạy.
