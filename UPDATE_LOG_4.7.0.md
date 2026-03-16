# Subtitle Grabber 4.7.0

## Mục tiêu
- Nâng cấp an toàn từ 4.6.1 mà không làm hỏng lõi YouTube + Netflix + pin.
- Thêm bộ nhớ cài đặt riêng cho từng nền tảng để tránh phải chỉnh lại mỗi lần đổi từ YouTube sang Netflix và ngược lại.

## Đã cập nhật
- Thêm `siteProfiles` trong settings storage, nhớ riêng cho `youtube` và `netflix`.
- Các giá trị được nhớ riêng theo từng nền tảng:
  - output mode
  - preferred target language
  - bilingual layout
  - show timestamp
  - dedupe / merge
  - prefer original track
  - auto fetch on change
  - auto scroll live
  - sync offset
  - sync profile
  - YouTube lead
- Khi popup phát hiện đang ở YouTube hoặc Netflix, extension sẽ tự áp dụng profile tương ứng trước khi tải metadata.
- Thêm chip `Profile memory` ở phần hero để biết profile nào đang hoạt động.
- Thêm khối `Site profile memory` trong Settings cùng nút `Reset site`.
- Diagnostics bundle giờ có thêm thông tin profile hiện tại và summary của profile đã lưu theo site.

## Test tĩnh đã chạy
- `node --check popup.js`
- `node --check pinned.js`
- `node --check background.js`
- parse `manifest.json`
- so khớp `getElementById(...)` giữa `popup.js` ↔ `popup.html`
- so khớp `getElementById(...)` giữa `pinned.js` ↔ `pinned.html`

## Ghi chú
- Không thay parser/fetch subtitle cũ.
- Không thay pinned window logic.
- Không sửa live capture/fallback của Netflix để tránh ảnh hưởng các chức năng đang ổn.
