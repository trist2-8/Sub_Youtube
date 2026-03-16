# UPDATE LOG 4.4.0

## Muc tieu ban nay
Sua loi popup chinh cua Netflix khong lay duoc subtitle, trong khi cua so pin da chay duoc.

## Da cap nhat
- Them `liveCaptureTimer`, `liveCaptureBuffer`, `liveCaptureLastText`, `liveCaptureActive` vao state popup chinh.
- Popup chinh gio tu dong dung live capture cua Netflix khi:
  - user chon track `Live capture`
  - hoac full track khong expose cues cho extension.
- Them `pageGetNetflixLiveSnapshot()` vao popup chinh de doc subtitle dang hien thi tren DOM Netflix.
- Them `startNetflixLiveCaptureWatcher()` / `stopLiveCaptureWatcher()` de luu toan bo qua trinh subtitle dang chay.
- Them track `Live capture` vao metadata Netflix trong popup chinh, khong con bi ket o trang thai `No subtitles found` khi Netflix khong lo full track.
- Sua `getTrackCacheKey()` de phan biet track Netflix theo `platform`, `fetchStrategy`, `textTrackIndex`, `domTrackIndex`.
- Sua badge cua popup chinh de hien `Live capture` khi dang fallback.
- Khong sua luong pin YouTube / Netflix dang on dinh.

## Ky vong sau ban nay
- Netflix trong popup chinh se bat duoc subtitle giong cua so pin.
- Khi full transcript khong doc duoc, popup chinh van co transcript dang tich luy tu live capture.
- YouTube va pin khong bi anh huong.
