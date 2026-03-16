# Subtitle Grabber 4.3.0

Ban nay tap trung sua lai cua so ghim de khong lam anh huong toi popup chinh va gia co them fallback cho YouTube pin.

## Diem moi

- Pin window dung file rieng `pinned.html` + `pinned.js`, khong dung chung popup chinh
- Pin YouTube uu tien doc full timedtext, neu timedtext khong parse duoc se tu chuyen sang live caption overlay
- Pin Netflix van giu luong full track neu co, neu khong se live capture subtitle dang hien thi
- Them **review log** luu lai qua trinh subtitle thay doi theo thoi gian
- Giam kich thuoc mac dinh cua cua so ghim de de vua xem video vua theo doi subtitle hon
- Tang do ben cua YouTube pin bang fetch timedtext theo nhieu bien the `json3`, `srv3`, `vtt`, `ttml`

## Ghi chu thuc te

- Popup chinh van giu luong rieng, pin chay doc lap
- YouTube pin da co fallback overlay nen ngay ca khi timedtext loi, ban van theo doi duoc subtitle dang hien tren video
- Netflix live capture se duoc luu lai trong review log, khong con hien roi mat ngay nua
