/** 段落批注：存放在 src/data/annotations/*.json，一个文件一条批注 */
export interface Annotation {
  /** 关联文章的文件名（不含 .md），即 post.id */
  post: string;
  /** 段落序号：文章正文里第几个块级元素（从 0 开始） */
  index: number;
  /** 段落文字片段，用于在内容变动后更准确定位 */
  quote?: string;
  /** 批注内容 */
  content: string;
  /** 日期 YYYY-MM-DD */
  date: string;
}
