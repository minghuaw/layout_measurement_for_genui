/* api.mjs — DeepSeek API call with thinking-level control.
 * request({ prompt, name, outDir, thinking, model, temperature, max_tokens })
 * Writes .req.json, .raw.json, .content.txt, .usage.json into outDir. */
import { writeFileSync } from 'node:fs';
import { reqPath, rawPath, contentPath, usagePath } from './artifacts.mjs';

export async function request({ prompt, name, outDir, thinking, model, temperature, max_tokens }) {
  const messages = [{ role: 'user', content: prompt }];
  const body = { model, temperature, max_tokens, stream: false, messages };
  if (thinking === 'off') {
    body.thinking = { type: 'disabled' };
  } else {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = thinking;
  }

  writeFileSync(reqPath(outDir, name), JSON.stringify(body, null, 2), 'utf8');

  const t0 = performance.now();
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const apiTimeMs = performance.now() - t0;
  const json = await res.json();
  const apiTimeS = Math.round(apiTimeMs / 10) / 100; // 2 decimals

  if (!json.choices || !json.choices[0]) {
    throw new Error('API error: ' + JSON.stringify(json).slice(0, 500));
  }
  const msg = json.choices[0].message;
  const finish = json.choices[0].finish_reason;
  const content = msg.content || '';
  const usage = {
    ...(json.usage || {}),
    effort: thinking,
    api_time_s: apiTimeS,
  };

  writeFileSync(rawPath(outDir, name), JSON.stringify(json, null, 2), 'utf8');
  writeFileSync(contentPath(outDir, name), content, 'utf8');
  writeFileSync(usagePath(outDir, name), JSON.stringify(usage, null, 2), 'utf8');

const reasonTok = (usage.completion_tokens_details || {}).reasoning_tokens ?? 0;
console.log(`  finish=${finish}  completion=${usage.completion_tokens}  reasoning=${reasonTok}  api_time=${apiTimeS}s`);
  return { finish_reason: finish, content, usage };
}