'use server';

/**
 * Server Action 示例：在服务端执行，可从客户端直接调用
 */

export async function greet(name: string): Promise<string> {
  if (!name?.trim()) return '请输入名字';
  // 模拟服务端逻辑（如查库、调 API）
  await new Promise((r) => setTimeout(r, 300));
  return `你好，${name.trim()}！（来自 Server Action，时间：${new Date().toLocaleTimeString('zh-CN')}）`;
}

export async function addNumbers(a: number, b: number): Promise<{ sum: number }> {
  return { sum: a + b };
}

export async function submitMessage(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const text = (formData.get('message') as string)?.trim();
  if (!text) return { ok: false, message: '内容不能为空' };
  // 服务端可写库、发通知等
  console.log('[Server Action] submitMessage:', text);
  return { ok: true, message: `已收到：${text}` };
}
