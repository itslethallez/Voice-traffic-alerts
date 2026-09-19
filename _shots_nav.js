const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Metres between two lat/lngs (equirectangular is fine at this scale).
const dist = (a, b) => {
  const dy = (b.latitude - a.latitude) * 111_320;
  const dx = (b.longitude - a.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dx, dy);
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 860, deviceScaleFactor: 2 });
  const context = browser.defaultBrowserContext();
  await context.overridePermissions('http://localhost:8741', ['geolocation']);
  // The driver's start point - Adelaide CBD, same as the other _shots scripts.
  const ORIGIN = { latitude: -34.9285, longitude: 138.6007 };
  await page.setGeolocation({ ...ORIGIN, accuracy: 5 });

  // ---- Speech capture, both backends -------------------------------------
  // Primary: Google Cloud TTS - capture the text in each /v1/text:synthesize
  // request body (the verbatim spoken utterance, with its real timestamp).
  const ttsLog = [];
  page.on('request', (req) => {
    if (req.url().includes('texttospeech.googleapis.com')) {
      try {
        const body = JSON.parse(req.postData() ?? '{}');
        ttsLog.push({ at: new Date().toISOString().slice(11, 19), channel: 'google', text: body?.input?.text });
      } catch {}
    }
  });
  // Fallback: the on-device voice path (expo-speech -> SpeechSynthesis on web).
  await page.evaluateOnNewDocument(() => {
    window.__spokenLog = [];
    const synth = window.speechSynthesis;
    if (synth && synth.speak) {
      const original = synth.speak.bind(synth);
      synth.speak = (utterance) => {
        window.__spokenLog.push(utterance.text);
        return original(utterance);
      };
    }
  });
  page.on('console', (msg) => {
    if (msg.text().includes('[navigate]') || msg.text().includes('[navigation]')) console.log('[page]', msg.text());
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.goto('http://localhost:8741/', { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => window.__shotgunMap && window.__shotgunMap.loaded(), { timeout: 90000 });
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
  await sleep(3000);

  // ---- Plan a route through the real UI ----------------------------------
  await page.click('[aria-label="Navigate - plan a trip"]');
  await page.waitForSelector('[aria-label="Destination search"]', { timeout: 10000 });
  await page.click('[aria-label="Destination search"]');
  // Glenelg: ~11km via Anzac Hwy - long legs guarantee every checkpoint
  // (500m/200m/50m) gets a clean firing window.
  await page.type('[aria-label="Destination search"]', 'Glenelg', { delay: 30 });
  await page.waitForSelector('[aria-label^="Set destination to"]', { timeout: 15000 });
  await page.click('[aria-label^="Set destination to"]');
  await page.waitForFunction(
    () => window.__shotgunRouteOptionsStore?.getState().status === 'ready',
    { timeout: 45000 }
  );
  console.log('[plan] route options ready');

  // Tap SIDE STREETS once - proves a card tap only previews (nav stays idle).
  const sideStreetsCard = await page.$('[aria-label^="SIDE STREETS route"]');
  if (sideStreetsCard) {
    await sideStreetsCard.click();
    await sleep(700);
    const statusAfterTap = await page.evaluate(() => window.__shotgunNavStore.getState().status);
    console.log('[plan] nav status after card tap (expect idle):', statusAfterTap);
  }

  await page.screenshot({ path: 'nav-c-options-go.png' });

  // GO - the explicit confirm. Back to FASTEST first so the ride is the
  // ordinary default route.
  const fastestCard = await page.$('[aria-label^="FASTEST route"]');
  if (fastestCard) await fastestCard.click();
  await sleep(400);
  await page.click('[aria-label^="Start navigation"]');
  await page.waitForFunction(
    () => window.__shotgunNavStore.getState().status === 'navigating',
    { timeout: 15000 }
  );
  console.log('[nav] navigation started');

  // ---- Build the movement replay -----------------------------------------
  const route = await page.evaluate(() => {
    const r = window.__shotgunNavStore.getState().activeRoute;
    return {
      polyline: r.polyline,
      maneuvers: r.steps.map((s) => ({ at: { latitude: s.maneuver.location[1], longitude: s.maneuver.location[0] }, instruction: s.maneuver.instruction })),
      km: (r.distanceMeters / 1000).toFixed(1),
    };
  });
  console.log(`[nav] route: ${route.km}km, ${route.polyline.length} polyline points, ${route.maneuvers.length} steps`);
  route.maneuvers.forEach((m, i) => console.log(`[nav]   step ${i}: ${m.instruction}`));

  // Cumulative distance along the polyline, and each maneuver's position
  // along it (index of its closest vertex).
  const cum = [0];
  for (let i = 1; i < route.polyline.length; i++) cum.push(cum[i - 1] + dist(route.polyline[i - 1], route.polyline[i]));
  const total = cum[cum.length - 1];
  const maneuverAt = route.maneuvers.map((m) => {
    let best = 0;
    for (let i = 0; i < route.polyline.length; i++) if (dist(route.polyline[i], m.at) < dist(route.polyline[best], m.at)) best = i;
    return cum[best];
  });

  // Replay positions: per upcoming maneuver, emit points ~700/480/180/40m
  // before it and at it - so the 500/200/50 checkpoints each get a distinct
  // crossing. Plus a mid-leg point so progress ticks are visible on long legs.
  const targets = new Set([0]);
  for (let k = 1; k < maneuverAt.length; k++) {
    for (const back of [700, 480, 180, 40]) {
      const d = maneuverAt[k] - back;
      if (d > maneuverAt[k - 1] + 5) targets.add(d);
    }
    targets.add(maneuverAt[k]);
    const mid = (maneuverAt[k - 1] + maneuverAt[k]) / 2;
    if (maneuverAt[k] - maneuverAt[k - 1] > 1500) targets.add(mid);
  }
  const pointAtDistance = (d) => {
    let i = cum.findIndex((c) => c >= d);
    if (i < 0) i = route.polyline.length - 1;
    return route.polyline[i];
  };
  const replay = [...targets].sort((a, b) => a - b).map((d) => ({ d, ...pointAtDistance(d) }));
  console.log(`[nav] replaying ${replay.length} positions over ${(total / 1000).toFixed(1)}km`);

  // ---- Drive the route ----------------------------------------------------
  const navSnapshot = () =>
    page.evaluate(() => {
      const n = window.__shotgunNavStore.getState();
      return { status: n.status, step: n.currentStepIndex, nextM: n.distanceToNextManeuverM, remainM: n.remainingDistanceM, etaMs: n.etaMs };
    });

  // Driver updates are serialized through tripRuntime's update chain, and a
  // maneuver cue AWAITS the whole TTS fetch+playback (~seconds) inside it -
  // the same production queuing that keeps a turn cue from talking over a
  // hazard readout. So the replay must pace itself on the chain having
  // processed each fix (visible as a store change), not on a fixed interval.
  const waitChainCatchUp = async (prev) => {
    try {
      await page.waitForFunction(
        (p) => {
          const n = window.__shotgunNavStore.getState();
          if (n.status === 'idle') return true;
          return (
            n.currentStepIndex !== p.step ||
            (n.distanceToNextManeuverM !== null && Math.abs(n.distanceToNextManeuverM - p.nextM) > 5) ||
            (n.remainingDistanceM !== null && Math.abs(n.remainingDistanceM - p.remainM) > 5)
          );
        },
        { timeout: 15000, polling: 250 },
        prev
      );
      return true;
    } catch {
      return false;
    }
  };

  let lastLogged = '';
  const logNav = async (d) => {
    const s = await navSnapshot();
    const line =
      `  ${(d / 1000).toFixed(2)}km along | status=${s.status} step=${s.step}` +
      ` next=${s.nextM === null ? null : Math.round(s.nextM)}m remain=${s.remainM === null ? null : Math.round(s.remainM)}m` +
      ` eta=${s.etaMs === null ? null : Math.max(0, Math.round((s.etaMs - Date.now()) / 60000))}min`;
    if (line !== lastLogged) {
      console.log(line);
      lastLogged = line;
    }
    return s;
  };

  let midShotTaken = false;
  let first = true;
  for (const pos of replay) {
    const before = await navSnapshot();
    await page.setGeolocation({ latitude: pos.latitude, longitude: pos.longitude, accuracy: 5 });
    if (first) {
      // The first fix lands in whatever state GO left; give the chain a
      // moment to publish initial progress rather than diffing nothing.
      await sleep(1500);
      first = false;
    } else {
      await waitChainCatchUp(before);
    }
    const s = await logNav(pos.d);
    if (s.status === 'idle') break; // arrived
    if (!midShotTaken && pos.d > total * 0.45) {
      midShotTaken = true;
      await page.screenshot({ path: 'nav-c-driving.png' });
    }
    await sleep(150);
  }

  // ---- Arrival -------------------------------------------------------------
  await page.waitForFunction(() => window.__shotgunNavStore.getState().status === 'idle', { timeout: 30000 });
  const arrivalState = await page.evaluate(() => {
    const n = window.__shotgunNavStore.getState();
    return { status: n.status, route: n.activeRoute, dest: n.destination, plan: window.__shotgunRouteOptionsStore.getState().status };
  });
  console.log('[arrival] nav store after arrival:', JSON.stringify(arrivalState));
  await sleep(1200);
  await page.screenshot({ path: 'nav-c-arrived.png' });

  // ---- End control: re-plan, start, END mid-route ---------------------------
  await page.click('[aria-label="Navigate - plan a trip"]');
  await page.waitForSelector('[aria-label="Destination search"]', { timeout: 10000 });
  await page.click('[aria-label="Destination search"]');
  await page.type('[aria-label="Destination search"]', 'Glenelg', { delay: 30 });
  await page.waitForSelector('[aria-label^="Set destination to"]', { timeout: 15000 });
  await page.click('[aria-label^="Set destination to"]');
  await page.waitForFunction(() => window.__shotgunRouteOptionsStore?.getState().status === 'ready', { timeout: 45000 });
  await page.click('[aria-label^="Start navigation"]');
  await page.waitForFunction(() => window.__shotgunNavStore.getState().status === 'navigating', { timeout: 15000 });
  await page.click('[aria-label="End navigation"]');
  await sleep(600);
  const afterEnd = await page.evaluate(() => window.__shotgunNavStore.getState().status);
  console.log('[end] nav status after END (expect idle):', afterEnd);

  // ---- Speech evidence ------------------------------------------------------
  const deviceLog = await page.evaluate(() => window.__spokenLog);
  console.log('\n=== SPOKEN UTTERANCES ===');
  ttsLog.forEach((u) => console.log(`  [${u.at}] GOOGLE-TTS: ${u.text}`));
  deviceLog.forEach((t) => console.log(`  DEVICE-TTS: ${t}`));

  console.log('done');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
