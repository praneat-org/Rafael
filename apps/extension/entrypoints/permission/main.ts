// The offscreen document cannot show a permission prompt, so the first mic grant happens here.
// The grant is per extension origin, so the offscreen document can use the mic afterwards.
const msg = document.getElementById('msg');
navigator.mediaDevices
  .getUserMedia({ audio: true })
  .then((s) => {
    for (const t of s.getTracks()) t.stop(); // we only wanted the grant, keep no audio
    window.close();
  })
  .catch(() => {
    if (msg)
      msg.textContent = 'ไม่ได้รับอนุญาตไมโครโฟน — เปิดอนุญาตในการตั้งค่าเว็บไซต์ของ extension แล้วลองใหม่';
  });
