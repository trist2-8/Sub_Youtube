# Subtitle Grabber 4.4.0

Ban nay tap trung sua mot diem con loi cuoi o popup chinh: Netflix pin da bat duoc live capture nhung popup chinh van khong lay duoc subtitle.

## Diem moi

- Popup chinh Netflix da co **live capture fallback** giong cua so pin
- Neu Netflix khong expose full cues, popup se tu chuyen sang doc subtitle dang hien thi tren player
- Them **track Live capture** trong danh sach Source cua popup chinh de co the chon truc tiep
- Neu track Netflix thuong khong doc duoc cues, popup se tu fallback sang live capture thay vi bao loi roi dung
- Live capture trong popup chinh se **luu lai toan bo qua trinh subtitle**, khong chi hien roi mat
- Giu nguyen luong YouTube va cua so pin dang on dinh

## Ghi chu thuc te

- Pin YouTube va pin Netflix van chay doc lap
- Popup chinh va pin gio da thong nhat logic fallback cho Netflix
- Khi Netflix khong lo full transcript, popup chinh van co the theo doi subtitle theo thoi gian thuc bang live capture


## 4.6.1
- Giữ nguyên lõi YouTube + Netflix + pin từ nhánh ổn định 4.4.x
- Bổ sung diagnostics bundle và session export an toàn
- Thêm sync profile và YouTube lead trong Settings
- Không đụng vào luồng fetch subtitle cũ để tránh làm mất chức năng hiện có
