// Fake library data for the Overlook UI kit.
(function () {
  const aspects = [[3, 2], [2, 3], [4, 3], [3, 4], [16, 9], [1, 1], [3, 2], [4, 3]];
  const cams = ["FUJIFILM X-T5", "SONY A7 IV", "APPLE iPHONE 15 PRO", "RICOH GR III"];
  const lenses = ["XF 35MM F/1.4", "FE 24-70MM F/2.8", "MAIN 24MM F/1.78", "GR 18.3MM F/2.8"];
  const places = ["Lisbon", "Big Sur", "Kyoto", "Home", "Dolomites", "Brooklyn"];
  const statuses = ["local", "synced", "synced", "synced", "offloaded", "syncing", "synced", "local"];
  const photos = [];
  for (let i = 0; i < 96; i++) {
    const t = (i % 28) + 1;
    const [aw, ah] = aspects[(t - 1) % 8];
    const w = aw * 1560, h = ah * 1560;
    photos.push({
      id: i,
      src: "../../assets/thumbs/t" + String(t).padStart(2, "0") + ".png",
      name: "IMG_" + (4021 + i * 7) + (i % 5 === 0 ? ".RAF" : ".JPG"),
      w, h,
      mp: Math.round((w * h) / 1e5) / 10,
      mb: (i % 5 === 0 ? 54.2 : 8.4) + (i % 7),
      camera: cams[i % 4],
      lens: lenses[i % 4],
      place: places[i % 6],
      date: "2026-" + String(6 - (i >> 5)).padStart(2, "0") + "-" + String(28 - (i % 27)).padStart(2, "0"),
      iso: [125, 200, 400, 800][i % 4],
      f: ["1.8", "2.8", "4.0", "5.6"][i % 4],
      shutter: ["1/250", "1/125", "1/60", "1/1000"][i % 4],
      focal: [23, 35, 50, 28][i % 4],
      status: statuses[i % 8],
      favorite: i % 9 === 0,
    });
  }
  window.OVERLOOK_PHOTOS = photos;
  window.OVERLOOK_ALBUMS = [
    { name: "Travel 2026", count: 1204, icon: "plane" },
    { name: "Family", count: 8312, icon: "users" },
    { name: "Big Sur", count: 214, icon: "mountain" },
    { name: "Kyoto Spring", count: 689, icon: "flower-2" },
  ];
})();
