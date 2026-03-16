# UPDATE LOG 4.0.0

## Mục tiêu bản này
- thêm chức năng ghim popup thành một cửa sổ live subtitle riêng
- giảm cảm giác subtitle YouTube bị chậm hơn giọng đọc
- cải thiện Netflix theo hướng thực dụng hơn: full track nếu site expose được, nếu không thì live capture subtitle đang hiển thị

## Các cập nhật chính
1. Thêm nút `pin` ở header.
2. Thêm message `OPEN_PINNED_WINDOW` ở background service worker để mở `popup.html?pinned=1&tabId=...`.
3. Manifest được nâng lên bản 4.0.0, khai báo `background.service_worker` và thêm host permission cho Netflix.
4. Pinned window có giao diện 2 cột:
   - cột trái: câu gốc/current cue
   - cột phải: bản dịch/current output nếu có
5. Thêm live sync cho transcript:
   - poll playback snapshot nhanh hơn
   - nội suy thời gian cục bộ giữa các lần snapshot
   - highlight cue đang phát
   - click line để seek video
6. Thêm setting `YouTube lead compensation` để đẩy highlight sớm hơn vài trăm ms.
7. Thêm `Netflix metadata` riêng.
8. Thêm `Netflix track fetch` riêng:
   - đọc `video.textTracks`
   - thử `track src`
   - fallback `live capture`
9. Thêm `pageGetLiveCaptionSnapshotV4()` để đọc subtitle overlay đang hiển thị trên Netflix.

## Lưu ý kỹ thuật
- Netflix không đảm bảo expose full subtitle track cho extension ở mọi title.
- Live capture là phương án dự phòng để vẫn dùng được subtitle hiện trên màn hình.
- YouTube sync đã nhanh hơn, nhưng độ khớp tuyệt đối vẫn phụ thuộc vào polling của popup extension và cách YouTube render cue.

## Hướng nâng cấp tiếp theo
- thêm preset sync mode: Balanced / Fast / Ultra
- thêm note nhỏ cho từng cue trong pinned window
- thêm tùy chọn ghim luôn on top bằng native host hoặc app wrapper nếu sau này cần
- thêm recorder để lưu riêng transcript Netflix live capture theo session
