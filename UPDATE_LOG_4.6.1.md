# UPDATE LOG 4.6.1

## Mục tiêu
- Đi tiếp từ nhánh ổn định, không làm mất các chức năng YouTube, Netflix và cửa sổ pin đã có.
- Ghép lại các nâng cấp an toàn của 4.5/4.6 theo cách không phá lõi.

## Đã cập nhật
- Dùng bản 4.4.0 làm nền ổn định vì đã có YouTube + Netflix + pin hoạt động.
- Thêm panel Diagnostics & session trong popup chính.
- Thêm nút Refresh report / Copy bundle / Export JSON / Export session.
- Thêm setting Timeline sync profile: Accurate / Smooth / Aggressive.
- Thêm setting YouTube lead (ms).
- Thêm chip hiển thị profile sync trong live sync bar.
- Thêm live sync hint ngay dưới sync bar.
- Ghi session log khi đổi platform, track, status, preview, cue đang chạy.
- Nâng version manifest lên 4.6.1.

## Lưu ý triển khai
- Không thay parser/fetch track của YouTube và Netflix.
- Không sửa pinned.html / pinned.js / background.js để tránh kéo lỗi chéo.
- Sync profile chỉ chỉnh logic bám cue trong popup, không ảnh hưởng file export.

## Test đã chạy
- node --check popup.js
- node --check pinned.js
- node --check background.js
- python parse manifest.json
- smoke test đối chiếu ID trong popup.js với popup.html
