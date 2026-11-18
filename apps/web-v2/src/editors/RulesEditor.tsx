import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Pilcrow,
  Strikethrough,
  Underline,
  Unlink,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TERMS_SCHEMES } from '@dnd/shared';
import { useI18n } from '../i18n';
import { cx, Icon, TextInput } from '../components/ui';

/**
 * One language of the server rules, as a WYSIWYG field. The formats it offers are the tags
 * of the allowlist in `@dnd/shared` (`TERMS_TAGS`): anything the server would strip is not
 * offered here, so what an admin writes is what gets stored.
 *
 * The language tabs sit above as borderless chips on the card; one bordered box holds the
 * toolbar, the link row and the canvas, dividing itself with hairlines. The box carries the
 * deepest step, so the text is written on the page color.
 */
export function RulesEditor({
  value,
  onChange,
  label,
  tabs,
  panelId,
  panelLabelledBy,
}: {
  value: string;
  onChange: (html: string) => void;
  label: string;
  /** Rendered at the head of the frame, sharing its border: which text this is. */
  tabs?: ReactNode;
  /** The canvas, named for the tab that shows it. */
  panelId?: string;
  panelLabelledBy?: string;
}) {
  const { t } = useI18n();
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const [linkError, setLinkError] = useState(false);
  // The toolbar lights up on the selection; a redraw is asked for on every selection move
  // rather than left to the editor's own re-render behaviour.
  const [, setSelection] = useState(0);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  const editor = useEditor(
    {
      immediatelyRender: false,
      content: value,
      editorProps: {
        attributes: {
          // No ring here: `.rich-text:focus-visible` in index.css drops it, and
          // `.rules-canvas:focus-within` draws one around the whole canvas instead.
          class: 'rich-text min-h-[180px] px-4 py-3',
          'aria-label': label,
        },
      },
      extensions: [
        StarterKit.configure({
          // Off: not in the allowlist, so the server would drop them on save.
          blockquote: false,
          code: false,
          codeBlock: false,
          horizontalRule: false,
          heading: { levels: [2, 3] },
          link: {
            openOnClick: false,
            autolink: false,
            markdownLinks: false,
            protocols: [...TERMS_SCHEMES],
            // The same attributes the server adds when it sanitizes, so the draft and the
            // saved text match.
            HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
          },
        }),
      ],
      onUpdate: ({ editor }) => changeRef.current(editor.getHTML()),
      onSelectionUpdate: () => setSelection((n) => n + 1),
    },
    [],
  );

  // A save returns sanitized text, which may differ from the draft: show what was stored.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  // The box holds its shape while the editor mounts, so the tabs never blink away.
  if (!editor) {
    return (
      <div className="flex flex-col gap-1">
        {tabs}
        <div className="min-h-[180px] rounded-[10px] border border-line bg-deep" />
      </div>
    );
  }

  const openLink = () => {
    setHref(editor.getAttributes('link').href ?? '');
    setLinkError(false);
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = href.trim();
    const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
    if (!url || (scheme && !(TERMS_SCHEMES as readonly string[]).includes(scheme))) {
      setLinkError(true);
      return;
    }
    // A bare address gets https, the one scheme a reader of rules is meant to reach.
    const target = scheme ? url : `https://${url}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href: target }).run();
    setLinkOpen(false);
  };

  return (
    <div className="flex flex-col gap-1">
      {tabs}
      {/* One bordered box: toolbar, link row and canvas divide themselves with hairlines.
          The canvas is the deepest step, so the text sits on the page color. */}
      <div className="overflow-hidden rounded-[10px] border border-line bg-deep">
        <div
          role="toolbar"
          aria-label={t('admin.terms.toolbar')}
          className="flex flex-wrap items-center gap-1 border-b border-line bg-raised p-1"
        >
          <Tool
            icon={Pilcrow}
            label={t('admin.terms.paragraph')}
            pressed={!editor.isActive('heading')}
            onClick={() => editor.chain().focus().setParagraph().run()}
          />
          <Tool
            icon={Heading2}
            label={t('admin.terms.heading2')}
            pressed={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <Tool
            icon={Heading3}
            label={t('admin.terms.heading3')}
            pressed={editor.isActive('heading', { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          />
          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          <Tool
            icon={Bold}
            label={t('admin.terms.bold')}
            pressed={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <Tool
            icon={Italic}
            label={t('admin.terms.italic')}
            pressed={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <Tool
            icon={Underline}
            label={t('admin.terms.underline')}
            pressed={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          />
          <Tool
            icon={Strikethrough}
            label={t('admin.terms.strike')}
            pressed={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          />
          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          <Tool
            icon={List}
            label={t('admin.terms.bullets')}
            pressed={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <Tool
            icon={ListOrdered}
            label={t('admin.terms.numbers')}
            pressed={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          <Tool
            icon={LinkIcon}
            label={t('admin.terms.link')}
            pressed={editor.isActive('link') || linkOpen}
            onClick={openLink}
          />
          <Tool
            icon={Unlink}
            label={t('admin.terms.removeLink')}
            disabled={!editor.isActive('link')}
            onClick={() => {
              editor.chain().focus().unsetLink().run();
              setLinkOpen(false);
            }}
          />
        </div>

        {linkOpen && (
          <div className="flex items-start gap-2 border-b border-line bg-card px-3 py-2">
            <div className="min-w-0 flex-1">
              <TextInput
                className=""
                value={href}
                autoFocus
                inputMode="url"
                placeholder="https://example.com/rules"
                aria-label={t('admin.terms.linkAddress')}
                onChange={(e) => {
                  setHref(e.target.value);
                  setLinkError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyLink();
                  }
                }}
              />
              {linkError && (
                <p className="pt-1 text-[13px] leading-5 text-danger">
                  {t('admin.terms.link.invalid')}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={applyLink}
              className="h-11 shrink-0 rounded-[10px] px-3 text-[14px] leading-5 font-medium text-ink transition-colors duration-150 hover:bg-raised"
            >
              {t('common.apply')}
            </button>
          </div>
        )}

        <div
          role={panelId ? 'tabpanel' : undefined}
          id={panelId}
          aria-labelledby={panelLabelledBy}
          className="rules-canvas min-h-[180px]"
        >
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

/** One toolbar button: a 44px target, a surface step while its format is on the selection. */
function Tool({
  icon,
  label,
  onClick,
  pressed = false,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cx(
        // 6px, not the usual 8: inside a 10px frame with 4px of padding, the nested radius
        // is 10 minus 4.
        'flex size-11 items-center justify-center rounded-[6px] transition-colors duration-150',
        pressed
          ? 'bg-raised text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]'
          : 'text-ink-2 hover:bg-raised/60 hover:text-ink',
        disabled && 'cursor-default text-ink-3 hover:bg-transparent hover:shadow-none',
      )}
    >
      <Icon icon={icon} />
    </button>
  );
}
