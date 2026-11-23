// Firebase AI Logic wiring. Each task gets its own model with an explicit inference mode:
//
//   findPersonal  ONLY_ON_DEVICE    reads the ORIGINAL letter -> must never fall back to cloud
//   deviceQuick   ONLY_ON_DEVICE    quick verdict on the ORIGINAL letter
//   hybridQuick   PREFER_ON_DEVICE  quick verdict on the REDACTED letter (no local model -> cloud)
//   explain       PREFER_IN_CLOUD   deep explanation of the REDACTED letter (offline -> device)
//   followUp      PREFER_ON_DEVICE  follow-up questions about the REDACTED letter
//   writer        ONLY_ON_DEVICE    Letter Desk: writes fictional practice letters (no user data)
//
// The response tells us where it actually ran (response.inferenceSource), and the UI shows it.

import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource } from 'firebase/ai';
import { SOURCE } from './pipeline.js';
import * as P from './prompts.js';

const env = import.meta.env || {};
export const CLOUD_MODEL = env.VITE_CLOUD_MODEL || 'gemini-3.5-flash-lite';

export function firebaseConfig() {
  const c = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  return c.apiKey && c.projectId && c.appId ? c : null;
}

const EN = [{ type: 'text', languages: ['en'] }];

function device(schema) {
  return {
    createOptions: { expectedInputs: EN, expectedOutputs: EN },
    promptOptions: { responseConstraint: schema },
  };
}

function cloud(schema, system) {
  return {
    model: CLOUD_MODEL,
    systemInstruction: system,
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0.2 },
  };
}

/** What Chrome says about its built-in model: available | downloadable | downloading | unavailable | unsupported */
export async function deviceStatus() {
  const LM = globalThis.LanguageModel;
  if (!LM?.availability) return 'unsupported';
  try {
    return await LM.availability({ expectedInputs: EN, expectedOutputs: EN });
  } catch {
    return 'unavailable';
  }
}

/** Ask Chrome to download its model (needs a user click). onProgress(0..1). */
export async function downloadDeviceModel(onProgress) {
  const LM = globalThis.LanguageModel;
  if (!LM?.create) throw new Error('This browser has no built-in model.');
  const s = await LM.create({
    expectedInputs: EN,
    expectedOutputs: EN,
    monitor(m) { m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded)); },
  });
  s.destroy?.();
}

// The small on-device model sometimes leaks a closing brace into the last string value
// ("...billing inquiries.}"). Strip stray trailing braces from every string in the result.
function tidy(v) {
  if (typeof v === 'string') return v.replace(/\s*\}+\s*$/, '');
  if (Array.isArray(v)) return v.map(tidy);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tidy(x)]));
  return v;
}

function parse(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  return tidy(JSON.parse(t));
}

function src(res) {
  return res.inferenceSource === InferenceSource.ON_DEVICE ? SOURCE.DEVICE : SOURCE.CLOUD;
}

/**
 * Build the deps object for pipeline.js. Returns null when Firebase is not configured.
 * deviceReady: whether Chrome's model is available right now.
 */
export function createAI({ deviceReady }) {
  const config = firebaseConfig();
  if (!config) return null;
  const app = initializeApp(config);
  if (env.VITE_APPCHECK_DEBUG) self.FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG === 'true' ? true : env.VITE_APPCHECK_DEBUG;
  if (env.VITE_RECAPTCHA_ENTERPRISE_KEY) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  }
  const ai = getAI(app, { backend: new GoogleAIBackend() });

  const findModel = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams: device(P.FIND_SCHEMA) });
  const deviceQuickModel = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams: device(P.QUICK_SCHEMA) });
  const hybridQuickModel = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: device(P.QUICK_SCHEMA),
    inCloudParams: cloud(P.QUICK_SCHEMA, P.QUICK_SYSTEM),
  });
  const explainModel = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_IN_CLOUD,
    onDeviceParams: device(P.EXPLAIN_SCHEMA),
    inCloudParams: cloud(P.EXPLAIN_SCHEMA, P.EXPLAIN_SYSTEM),
  });
  // Letter Desk: practice letters are written on the device only (free, offline, endless).
  const writerModel = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams: device(P.WRITE_SCHEMA) });
  const followModel = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: device(P.FOLLOW_SCHEMA),
    inCloudParams: cloud(P.FOLLOW_SCHEMA, P.FOLLOW_SYSTEM),
  });

  async function run(model, prompt) {
    const r = await model.generateContent(prompt);
    const res = r.response;
    return { data: parse(res.text()), source: src(res), payload: prompt };
  }

  return {
    device: deviceReady
      ? {
          available: true,
          findPersonal: async (text) => (await run(findModel, P.findPrompt(text))).data.items || [],
          quick: async (text) => (await run(deviceQuickModel, P.quickPrompt(text, false))).data,
          writeLetter: async (kind, topic) => (await run(writerModel, P.writePrompt(kind, topic))).data,
        }
      : null,
    hybrid: {
      quick: (redacted) => run(hybridQuickModel, P.quickPrompt(redacted, true)),
      followUp: (redacted, q) => run(followModel, P.followPrompt(redacted, q)),
    },
    cloud: {
      explain: (redacted) => run(explainModel, P.explainPrompt(redacted)),
    },
  };
}
