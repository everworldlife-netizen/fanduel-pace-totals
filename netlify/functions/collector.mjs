import { getStore } from '@netlify/blobs';
import storeModule from '../../src/store.js';
import trackerModule from '../../src/ebTracker.js';

// Tracks every FanDuel eBasketball game, grades the model's calls against
// official H2H GG League finals, and refreshes player ratings hourly.
// Runs every 2 minutes (UTC). Set COLLECTOR_ENABLED=0 to pause it.
export default async () => {
  if (Netlify.env.get('COLLECTOR_ENABLED') === '0') {
    console.log('collector paused (COLLECTOR_ENABLED=0)');
    return;
  }
  storeModule.configure(getStore);
  const report = await trackerModule.collect();
  console.log(JSON.stringify(report));
};

export const config = {
  schedule: '*/2 * * * *',
};
