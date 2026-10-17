import React, { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathTextProps {
  text: string;
  className?: string;
}

/**
 * Renders text that may contain LaTeX math equations ($...$, $$...$$, \(...\), \[...\])
 * as well as standalone LaTeX commands (\frac, \sqrt, \int, \sum, etc.) and multilingual
 * scripts (Malayalam, Hindi Devanagari, Indian English).
 */
export const MathText: React.FC<MathTextProps> = ({ text, className = '' }) => {
  const segments = useMemo(() => {
    if (!text) return [];
    const normalized = autoWrapBareLatex(String(text));

    // Match $$...$$, \[...\], $...$, or \(...\)
    const tokenRegex = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$(?:\\.|[^$\\])+\$|\\\([\s\S]+?\\\))/g;
    const parts: Array<{ type: 'text' | 'math-inline' | 'math-block'; content: string }> = [];

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(normalized)) !== null) {
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: normalized.slice(lastIndex, match.index)
        });
      }

      const raw = match[0];
      if (raw.startsWith('$$') && raw.endsWith('$$')) {
        parts.push({ type: 'math-block', content: raw.slice(2, -2).trim() });
      } else if (raw.startsWith('\\[') && raw.endsWith('\\]')) {
        parts.push({ type: 'math-block', content: raw.slice(2, -2).trim() });
      } else if (raw.startsWith('\\(') && raw.endsWith('\\)')) {
        parts.push({ type: 'math-inline', content: raw.slice(2, -2).trim() });
      } else if (raw.startsWith('$') && raw.endsWith('$')) {
        parts.push({ type: 'math-inline', content: raw.slice(1, -1).trim() });
      } else {
        parts.push({ type: 'text', content: raw });
      }

      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < normalized.length) {
      parts.push({
        type: 'text',
        content: normalized.slice(lastIndex)
      });
    }

    return parts;
  }, [text]);

  if (!text) return null;

  return (
    <span className={`math-text-container ${className}`}>
      {segments.map((seg, idx) => {
        if (seg.type === 'text') {
          return <React.Fragment key={idx}>{seg.content}</React.Fragment>;
        }
        try {
          const html = katex.renderToString(seg.content, {
            displayMode: seg.type === 'math-block',
            throwOnError: false,
            strict: false,
            trust: true
          });
          return (
            <span
              key={idx}
              className={seg.type === 'math-block' ? 'block my-1.5 overflow-x-auto' : 'inline-block mx-0.5 align-middle'}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        } catch {
          return <code key={idx} className="font-mono text-indigo-300">{seg.content}</code>;
        }
      })}
    </span>
  );
};

/**
 * If an AI response includes bare LaTeX commands like \frac{a}{b} or \sqrt{x}
 * without surrounding $...$ delimiters, automatically wrap those expressions
 * so KaTeX renders them cleanly.
 */
function autoWrapBareLatex(input: string): string {
  if (input.includes('$') || input.includes('\\(') || input.includes('\\[')) {
    return input;
  }
  if (!/\\(?:frac|sqrt|int|sum|prod|lim|sin|cos|tan|log|ln|alpha|beta|gamma|theta|pi|Delta|sigma|omega|infty|pm|times|div|leq|geq|neq|vec|hat|overline|cdot)\b/.test(input)) {
    return input;
  }
  return input.replace(
    /(\\(?:frac\{[^{}]*\}\{[^{}]*\}|sqrt(?:\[[^\]]*\])?\{[^{}]*\}|(?:int|sum|prod|lim)(?:_\{?[^{}\s]+\}?)?(?:\^\{?[^{}\s]+\}?)?|(?:alpha|beta|gamma|theta|pi|Delta|sigma|omega|infty|pm|times|div|leq|geq|neq|cdot)\b))/g,
    '$$$1$$'
  );
}

export interface MathTemplate {
  label: string;
  preview: string;
  latex: string;
}

export const QUICK_MATH_TEMPLATES: MathTemplate[] = [
  { label: 'Fraction', preview: 'a/b', latex: '$\\frac{a}{b}$' },
  { label: 'Square Root', preview: '√x', latex: '$\\sqrt{x}$' },
  { label: 'Power / Exponent', preview: 'x² + y²', latex: '$x^2 + y^2 = r^2$' },
  { label: 'Quadratic Formula', preview: 'x = (-b±√Δ)/2a', latex: '$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$' },
  { label: 'Definite Integral', preview: '∫ f(x)dx', latex: '$\\int_{a}^{b} f(x)\\,dx$' },
  { label: 'Derivative', preview: 'dy/dx', latex: '$\\frac{dy}{dx}$' },
  { label: 'Summation', preview: '∑ n', latex: '$\\sum_{n=1}^{\\infty} a_n$' },
  { label: 'Limit', preview: 'lim x→0', latex: '$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$' },
  { label: 'Trigonometry', preview: 'sin²θ + cos²θ', latex: '$\\sin^2\\theta + \\cos^2\\theta = 1$' },
  { label: 'Logarithm', preview: 'logₐ(x)', latex: '$\\log_{a}(x)$' },
  { label: 'Matrix 2×2', preview: '[a b; c d]', latex: '$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$' },
  { label: 'Vector / Physics', preview: 'F = ma', latex: '$\\vec{F} = m\\vec{a}$' }
];

interface MathEquationToolbarProps {
  onInsert: (latexSnippet: string) => void;
  compact?: boolean;
}

export const MathEquationToolbar: React.FC<MathEquationToolbarProps> = ({ onInsert, compact = false }) => {
  return (
    <div className="p-2.5 rounded-xl bg-slate-950/90 border border-indigo-500/25 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-indigo-300 flex items-center gap-1.5">
          <span className="font-mono bg-indigo-500/20 px-1.5 py-0.5 rounded text-indigo-300">∑ fx</span>
          <span>Insert Math Equations &amp; LaTeX Formulas (wrap math in $...$)</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(compact ? QUICK_MATH_TEMPLATES.slice(0, 8) : QUICK_MATH_TEMPLATES).map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => onInsert(item.latex)}
            title={`Insert ${item.label}: ${item.latex}`}
            className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-indigo-600/25 border border-slate-800 hover:border-indigo-500/40 text-[11px] text-slate-200 hover:text-white flex items-center gap-1.5 transition"
          >
            <span className="font-mono text-indigo-300 font-bold">{item.preview}</span>
            <span className="text-slate-400 text-[10px] hidden sm:inline">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
