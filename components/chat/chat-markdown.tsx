"use client";

import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

type Props = {
  content: string;
  className?: string;
  /** Blinking caret after the last line of the last block (streaming). Uses ::after so it stays inline with text. */
  streamCaret?: boolean;
};

/** Tailwind: trailing caret on common “last streaming” block roots. */
const streamCaretAfter =
  "[&>p:last-child]:after:ml-0.5 [&>p:last-child]:after:inline-block [&>p:last-child]:after:h-4 [&>p:last-child]:after:w-0.5 [&>p:last-child]:after:animate-pulse [&>p:last-child]:after:bg-foreground [&>p:last-child]:after:align-text-bottom [&>p:last-child]:after:content-[''] " +
  "[&>h1:last-child]:after:ml-0.5 [&>h1:last-child]:after:inline-block [&>h1:last-child]:after:h-4 [&>h1:last-child]:after:w-0.5 [&>h1:last-child]:after:animate-pulse [&>h1:last-child]:after:bg-foreground [&>h1:last-child]:after:align-text-bottom [&>h1:last-child]:after:content-[''] " +
  "[&>h2:last-child]:after:ml-0.5 [&>h2:last-child]:after:inline-block [&>h2:last-child]:after:h-4 [&>h2:last-child]:after:w-0.5 [&>h2:last-child]:after:animate-pulse [&>h2:last-child]:after:bg-foreground [&>h2:last-child]:after:align-text-bottom [&>h2:last-child]:after:content-[''] " +
  "[&>h3:last-child]:after:ml-0.5 [&>h3:last-child]:after:inline-block [&>h3:last-child]:after:h-4 [&>h3:last-child]:after:w-0.5 [&>h3:last-child]:after:animate-pulse [&>h3:last-child]:after:bg-foreground [&>h3:last-child]:after:align-text-bottom [&>h3:last-child]:after:content-[''] " +
  "[&>ul:last-child>li:last-child]:after:ml-0.5 [&>ul:last-child>li:last-child]:after:inline-block [&>ul:last-child>li:last-child]:after:h-4 [&>ul:last-child>li:last-child]:after:w-0.5 [&>ul:last-child>li:last-child]:after:animate-pulse [&>ul:last-child>li:last-child]:after:bg-foreground [&>ul:last-child>li:last-child]:after:align-text-bottom [&>ul:last-child>li:last-child]:after:content-[''] " +
  "[&>ol:last-child>li:last-child]:after:ml-0.5 [&>ol:last-child>li:last-child]:after:inline-block [&>ol:last-child>li:last-child]:after:h-4 [&>ol:last-child>li:last-child]:after:w-0.5 [&>ol:last-child>li:last-child]:after:animate-pulse [&>ol:last-child>li:last-child]:after:bg-foreground [&>ol:last-child>li:last-child]:after:align-text-bottom [&>ol:last-child>li:last-child]:after:content-[''] " +
  "[&>blockquote:last-child]:after:ml-0.5 [&>blockquote:last-child]:after:inline-block [&>blockquote:last-child]:after:h-4 [&>blockquote:last-child]:after:w-0.5 [&>blockquote:last-child]:after:animate-pulse [&>blockquote:last-child]:after:bg-foreground [&>blockquote:last-child]:after:align-text-bottom [&>blockquote:last-child]:after:content-['']";

/**
 * Безопасный рендер Markdown в чате: **жирный**, списки, код, ссылки, переносы строк.
 */
export function ChatMarkdown({ content, className, streamCaret }: Props) {
  return (
    <div className={cn(className, streamCaret && streamCaretAfter)}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ className: codeClass, children, ...props }) => {
            const isBlock = /language-\w+/.test(codeClass ?? "");
            if (isBlock) {
              return (
                <code className={codeClass} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded-md bg-muted/80 px-1.5 py-0.5 font-mono text-[0.9em] text-foreground"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0">
              {children}
            </pre>
          ),
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-primary underline underline-offset-2 hover:opacity-90"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          h1: ({ children }) => <h1 className="mt-3 mb-2 font-semibold text-base first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-3 mb-1.5 font-semibold text-[0.95rem] first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-2 mb-1 font-semibold text-sm first:mt-0">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-border border-l-2 pl-3 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted/50 px-2 py-1.5 font-medium">{children}</th>
          ),
          td: ({ children }) => <td className="border border-border px-2 py-1.5">{children}</td>,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
