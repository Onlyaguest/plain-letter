// Screenshot / photo to text, on the device: tesseract.js (Apache-2.0) with the English
// model (tessdata, Apache-2.0). Files are served from this site's ./ocr/ folder; the image
// is never uploaded anywhere.

let workerP = null;

function base() {
  return new URL('./ocr/', document.baseURI).href;
}

async function getWorker() {
  if (!workerP) {
    workerP = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng', 1, {
        workerPath: base() + 'worker.min.js',
        corePath: base() + 'core/',
        langPath: base() + 'lang',
        gzip: true,
      });
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

/** Big photos are shrunk first: faster, and lighter on older laptops. */
function shrink(file, max = 2000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be opened.')); };
    img.src = url;
  });
}

export async function recognize(file) {
  const canvas = await shrink(file);
  const w = await getWorker();
  const { data } = await w.recognize(canvas);
  return String(data.text || '').replace(/\n{3,}/g, '\n\n').trim();
}
