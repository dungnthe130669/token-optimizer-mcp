/**
 * Local embedding via @huggingface/transformers v3 — all-MiniLM-L6-v2
 * Pure JS/WASM, no native deps, no API key.
 * Model: ~22MB, downloads once to ~/.cache/huggingface/
 * Output: Float32Array[384]
 */

let _pipeline: any = null;

async function getPipeline() {
  if (_pipeline) return _pipeline;
  const { pipeline } = await import('@huggingface/transformers');
  _pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  return _pipeline;
}

export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getPipeline();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  const data = output.data ?? output.tolist?.() ?? output;
  return data instanceof Float32Array ? data : new Float32Array(Array.from(data as number[]));
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const results: Float32Array[] = [];
  for (const text of texts) results.push(await embed(text));
  return results;
}
