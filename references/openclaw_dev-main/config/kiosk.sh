#!/bin/sh
while ! curl -s http://127.0.0.1:18789/ > /dev/null 2>&1; do
    sleep 2
done

# 只保留 video20，隐藏其他 video 设备
for dev in /dev/video*; do
    case "$dev" in
        /dev/video20) ;;
        *) sudo chmod 000 "$dev" 2>/dev/null ;;
    esac
done

openbox &
chromium --kiosk \
    --no-first-run \
    --disable-translate \
    --disable-infobars \
    --disable-suggestions-service \
    --disable-save-password-bubble \
    --disable-session-crashed-bubble \
    --noerrdialogs \
    --use-fake-ui-for-media-stream \
    --autoplay-policy=no-user-gesture-required \
    --unsafely-treat-insecure-origin-as-secure="http://127.0.0.1:8080" \
    --enable-features=InsecureOriginAsSecure \
    --enable-logging --v=1 "http://127.0.0.1:8080/"
