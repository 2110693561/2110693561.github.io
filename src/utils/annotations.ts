import type { Annotation } from "../types";

/** 读取 src/data/annotations/*.json（CMS 后台维护），按文章 slug 分组 */
export function loadAnnotations(): Map<string, Annotation[]> {
  const modules = import.meta.glob("/src/data/annotations/*.json", {
    eager: true,
  }) as Record<string, { default?: unknown } | unknown>;

  const map = new Map<string, Annotation[]>();
  for (const mod of Object.values(modules)) {
    // Vite 的 JSON 导入可能是 { default: data } 或直接就是数据
    const data = (mod as { default?: unknown }).default ?? mod;
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      const anno = item as Annotation;
      if (!anno || typeof anno.post !== "string") continue;
      const list = map.get(anno.post) ?? [];
      list.push(anno);
      map.set(anno.post, list);
    }
  }
  return map;
}
