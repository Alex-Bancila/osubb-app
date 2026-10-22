import {
  Component,
  lazy,
  Suspense,
  useId,
  type ReactNode,
  type Ref,
} from 'react';
import { visibleLength } from '../../lib/formatted-text/plain';
import { cn } from '../../lib/utils';
import { Textarea } from '../ui/input';

/** The visible characters a Formatted Text may hold (decision 10). */
const VISIBLE_LIMIT = 2000;

const FormattedTextEditor = lazy(() => import('./editor/FormattedTextEditor'));

export type FormattedTextFieldProps = {
  id: string;
  /** The id of the field's visible label: it names the text (ruling 31). */
  labelId: string;
  name: string;
  value: string;
  onChange: (markdown: string) => void;
  required?: boolean;
  ref?: Ref<HTMLElement>;
  onBlur?: () => void;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

/**
 * Without the editor's chunk (offline the first time a form opens), the
 * field is the plain text area it was before R60: the form never breaks.
 */
class EditorUnavailable extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * A Formatted Text field (ruling R60, §C): the Mesaj of an Announcement, the
 * Descriere of a Deal, a Task or an Event, the Detalii of a completed Task.
 * It writes Markdown in the reader's dialect and counts what the reader shows
 * ("N / 2000 caractere"). The editor is its own chunk, loaded when the form
 * opens; until then the text shows read-only in a text area with the
 * field's `id`, so its label still names it.
 */
export function FormattedTextField({
  id,
  labelId,
  name,
  value,
  onChange,
  required = false,
  ref,
  onBlur,
  'aria-invalid': invalid,
  'aria-describedby': ariaDescribedBy,
}: FormattedTextFieldProps) {
  const counterId = useId();
  const describedBy = [ariaDescribedBy, counterId].filter(Boolean).join(' ');
  const length = visibleLength(value);
  // A text area is an HTMLElement: the form's ref takes it as it takes the
  // editor's text.
  const textareaRef = ref as Ref<HTMLTextAreaElement> | undefined;

  return (
    <div data-slot="formatted-text-field" className="grid gap-1.5">
      <EditorUnavailable
        fallback={
          <Textarea
            id={id}
            name={name}
            required={required}
            rows={4}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            ref={textareaRef}
            onBlur={onBlur}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        }
      >
        <Suspense
          fallback={
            <Textarea
              id={id}
              name={name}
              readOnly
              rows={4}
              value={value}
              ref={textareaRef}
              aria-describedby={describedBy}
            />
          }
        >
          <FormattedTextEditor
            id={id}
            labelId={labelId}
            value={value}
            onChange={onChange}
            required={required}
            inputRef={ref}
            onBlur={onBlur}
            invalid={invalid === true}
            describedBy={describedBy}
          />
        </Suspense>
      </EditorUnavailable>
      <p
        id={counterId}
        className={cn(
          'text-right text-xs tabular-nums',
          length > VISIBLE_LIMIT ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {length} / {VISIBLE_LIMIT} caractere
      </p>
    </div>
  );
}
