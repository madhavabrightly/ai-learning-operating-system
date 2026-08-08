declare module 'mammoth/mammoth.browser' {
  export interface MammothResult {
    value: string;
    messages: { type: string; message: string }[];
  }

  export interface ConvertOptions {
    arrayBuffer?: ArrayBuffer;
    path?: string;
  }

  export function convertToHtml(input: ConvertOptions): Promise<MammothResult>;
  export function convertToPlainText(input: ConvertOptions): Promise<MammothResult>;
  export function extractRawText(input: ConvertOptions): Promise<MammothResult>;
}

declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const url: string;
  export default url;
}

declare module '*?url' {
  const url: string;
  export default url;
}
