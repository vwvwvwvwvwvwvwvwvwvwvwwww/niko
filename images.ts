/** Фото базы отдыха «Нико»: лес, река, домики, костёр, активный отдых */
export const SITE_IMAGES = {
  // Главная — сосновый лес, солнечная тропа
  hero: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e',
  parallax: 'https://images.unsplash.com/photo-1519339943796-9fa059a2a36e',
  heroVideo: 'https://cdn.coverr.co/videos/mp4/coverr-coniferous-forest-1571060945952.mp4',
  riverVideo: 'https://cdn.coverr.co/videos/mp4/coverr-river-near-the-mountains-1571060945890.mp4',
  // 360° — лесная поляна (Wikimedia)
  panorama360: 'https://upload.wikimedia.org/wikipedia/commons/4/47/360_Grad_Panorama_Wald_B%C3%B6den_bei_G%C3%B6ttingen.jpg',

  // О нас — деревянный домик у воды, вечер у костра
  aboutMain: 'https://images.unsplash.com/photo-1449157291145-7efd17672941',
  aboutSecondary: 'https://images.unsplash.com/photo-1478145046307-489995a10356',

  // Лента «живые события»
  liveRiver: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470',
  liveQuad: 'https://images.unsplash.com/photo-1531956461690-939999056637',

  slider: [
    'https://images.unsplash.com/photo-1478145046307-489995a10356',
    'https://images.unsplash.com/photo-1528607929212-263eb1b25c21',
    'https://images.unsplash.com/photo-1519339943796-9fa059a2a36e',
  ],

  panoramaDeck: 'https://images.unsplash.com/photo-1449157291145-7efd17672941',

  gallery: [
    'https://images.unsplash.com/photo-1449157291145-7efd17672941',
    'https://images.unsplash.com/photo-1519339943796-9fa059a2a36e',
    'https://images.unsplash.com/photo-1478145046307-489995a10356',
    'https://images.unsplash.com/photo-1528607929212-263eb1b25c21',
    'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4',
    'https://images.unsplash.com/photo-1531956461690-939999056637',
    'https://images.unsplash.com/photo-1579168765460-d7201e83500f',
    'https://images.unsplash.com/photo-1530866495547-15bcdc58440a',
    'https://images.unsplash.com/photo-1595246140625-573b715d11dc',
    'https://images.unsplash.com/photo-1544161024-18859e163f7e',
    'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7',
    'https://images.unsplash.com/photo-1441974231531-c6227db76b6e',
  ],

  services: {
    'Квадроциклы': 'https://images.unsplash.com/photo-1531956461690-939999056637',
    'Конные прогулки': 'https://images.unsplash.com/photo-1579168765460-d7201e83500f',
    'Сплав по реке': 'https://images.unsplash.com/photo-1530866495547-15bcdc58440a',
    'Пейнтбол': 'https://images.unsplash.com/photo-1595246140625-573b715d11dc',
    'Баня на дровах': 'https://images.unsplash.com/photo-1544161024-18859e163f7e',
  },

  events: {
    'Йога-тур "Гармония"': 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b',
    'Турнир по пейнтболу': 'https://images.unsplash.com/photo-1595246140625-573b715d11dc',
    'Концерт у костра': 'https://images.unsplash.com/photo-1478145046307-489995a10356',
  },

  news: [
    'https://images.unsplash.com/photo-1441974231531-c6227db76b6e',
    'https://images.unsplash.com/photo-1531956461690-939999056637',
    'https://images.unsplash.com/photo-1511632765486-a01980e01a18',
  ],

  defaultService: 'https://images.unsplash.com/photo-1449157291145-7efd17672941',
} as const;

export function syncSiteImages(db: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } }) {
  for (const [name, url] of Object.entries(SITE_IMAGES.services)) {
    db.prepare('UPDATE services SET image_url = ? WHERE name = ?').run(url, name);
  }
  for (const [title, url] of Object.entries(SITE_IMAGES.events)) {
    db.prepare('UPDATE events SET image_url = ? WHERE title = ?').run(url, title);
  }
  db.prepare('DELETE FROM gallery_photos').run();
  const insertGallery = db.prepare('INSERT INTO gallery_photos (image_url) VALUES (?)');
  for (const url of SITE_IMAGES.gallery) {
    insertGallery.run(url);
  }
}
