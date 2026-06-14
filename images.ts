/** Локальные фото базы отдыха «Нико» — лежат в public/images/ */
const img = (name: string) => `/images/${name}`;

export const SITE_IMAGES = {
  hero: img('forest.jpg'),
  parallax: img('misty-forest.jpg'),
  heroVideo: 'https://cdn.coverr.co/videos/mp4/coverr-coniferous-forest-1571060945952.mp4',
  riverVideo: 'https://cdn.coverr.co/videos/mp4/coverr-river-near-the-mountains-1571060945890.mp4',
  panorama360: img('lake-dawn.jpg'),

  aboutMain: img('cabin.jpg'),
  aboutSecondary: img('campfire.jpg'),

  liveRiver: img('lake-dawn.jpg'),
  liveQuad: img('quad.jpg'),

  slider: [img('campfire.jpg'), img('camping.jpg'), img('lake-dawn.jpg')],

  panoramaDeck: img('forest-road.jpg'),

  gallery: [
    img('cabin.jpg'),
    img('lake-dawn.jpg'),
    img('campfire.jpg'),
    img('camping.jpg'),
    img('quad.jpg'),
    img('horses.jpg'),
    img('rafting.jpg'),
    img('paintball.jpg'),
    img('banya.jpg'),
    img('forest-road.jpg'),
    img('mountains.jpg'),
    img('friends.jpg'),
  ],

  services: {
    'Квадроциклы': img('quad.jpg'),
    'Конные прогулки': img('horses.jpg'),
    'Сплав по реке': img('rafting.jpg'),
    'Пейнтбол': img('paintball.jpg'),
    'Баня на дровах': img('banya.jpg'),
  },

  events: {
    'Йога-тур "Гармония"': img('yoga.jpg'),
    'Турнир по пейнтболу': img('paintball.jpg'),
    'Концерт у костра': img('campfire.jpg'),
  },

  news: [img('season.jpg'), img('quad.jpg'), img('friends.jpg')],

  defaultService: img('cabin.jpg'),
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
