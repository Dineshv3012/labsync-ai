declare module 'pdf-parse/lib/pdf-parse.js' {
  const fn: (data: Buffer) => Promise<{ text: string; numpages: number }>;
  export default fn;
}
