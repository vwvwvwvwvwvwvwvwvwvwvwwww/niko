/** Подобранные фото для базы отдыха «Нико» (Unsplash + 360° панорама) */
export const SITE_IMAGES = {
  hero: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e',
  parallax: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470',
  heroVideo: 'https://cdn.coverr.co/videos/mp4/coverr-coniferous-forest-1571060945952.mp4',
  riverVideo: 'https://cdn.coverr.co/videos/mp4/coverr-river-near-the-mountains-1571060945890.mp4',
  panorama360: 'https://upload.wikimedia.org/wikipedia/commons/8/89/Meadow_Lake%2C_Idaho.jpg',

  aboutMain: 'https://images.unsplash.com/photo-1600607687939-ce8a6e251371',
  aboutSecondary: 'https://images.unsplash.com/photo-1518780669349-6883958253aa',

  liveRiver: 'https://images.unsplash.com/photo-1439066615861-d1af7746ee7a',
  liveQuad: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64',

  slider: [
    'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7',
    'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05',
    'https://images.unsplash.com/photo-1478145046307-489995a10356',
  ],

  panoramaDeck: 'https://images.unsplash.com/photo-1600607687939-ce8a6e251371',

  gallery: [
    'https://images.unsplash.com/photo-1600607687939-ce8a6e251371',
    'https://images.unsplash.com/photo-1501785888041-af3ef285b470',
    'https://images.unsplash.com/photo-1478145046307-489995a10356',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64',
    'https://images.unsplash.com/photo-1553284965-83fd3e82fa5a',
    'https://images.unsplash.com/photo-1530866495547-15bcdc58440a',
    'https://images.unsplash.com/photo-1593266146119-57ee044e79a5',
    'https://images.unsplash.com/photo-1599359907089-79d77d9a747a',
    'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4',
    'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7',
    'https://images.unsplash.com/photo-1439066615861-d1af7746ee7a',
    'https://images.unsplash.com/photo-1473496169904-658ba89e39f8',
  ],

  services: {
    'Квадроциклы': 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64',
    'Конные прогулки': 'https://images.unsplash.com/photo-1553284965-83fd3e82fa5a',
    'Сплав по реке': 'https://images.unsplash.com/photo-1530866495547-15bcdc58440a',
    'Пейнтбол': 'https://images.unsplash.com/photo-1593266146119-57ee044e79a5',
    'Баня на дровах': 'https://images.unsplash.com/photo-1599359907089-79d77d9a747a',
  },

  events: {
    'Йога-тур "Гармония"': 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b',
    'Турнир по пейнтболу': 'https://images.unsplash.com/photo-1593266146119-57ee044e79a5',
    'Концерт у костра': 'https://images.unsplash.com/photo-1478145046307-489995a10356',
  },

  news: [
    'https://images.unsplash.com/photo-1441974231531-c6227db76b6e',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64',
    'https://images.unsplash.com/photo-1511632765486-a01980e01a18',
  ],

  defaultService: 'https://images.unsplash.com/photo-1600607687939-ce8a6e251371',
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
