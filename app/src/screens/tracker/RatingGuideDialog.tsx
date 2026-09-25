import { BookOpenIcon, Star } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import { useEvaluationScale } from '../../queries/reference';
import { ratingGuide } from './rating-guide-content';

function Stars({ count }: { count: number }) {
  return (
    <span aria-hidden="true" className="flex shrink-0 gap-px">
      {[1, 2, 3, 4, 5].map((step) => (
        <Star
          key={step}
          strokeWidth={1.75}
          className={
            step <= count
              ? 'size-3.5 fill-primary text-primary'
              : 'size-3.5 text-muted-foreground/50'
          }
        />
      ))}
    </span>
  );
}

function Difficulty() {
  const scale = useEvaluationScale();
  if (scale.isPending)
    return (
      <p role="status" className="text-sm">
        Se încarcă dificultățile…
      </p>
    );
  if (scale.isError)
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>Nu am putut încărca dificultățile.</p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={scale.isFetching}
          onClick={() => void scale.refetch()}
        >
          Reîncarcă
        </Button>
      </div>
    );
  return (
    <ol className="divide-y divide-border">
      {scale.data.difficulties.map((row) => (
        <li key={row.stars} className="flex items-baseline gap-3 py-2">
          <span className="w-4 shrink-0 text-right font-bold tabular-nums">
            {row.stars}
          </span>
          <span className="min-w-0 wrap-anywhere">{row.note}</span>
        </li>
      ))}
    </ol>
  );
}

/** Opens the rating guide beside the rating controls, without leaving the form. */
export function RatingGuideDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={<Button type="button" variant="outline" className="min-h-11" />}
      >
        <BookOpenIcon aria-hidden="true" />
        {ratingGuide.title}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{ratingGuide.title}</DialogTitle>
          <DialogDescription>{ratingGuide.description}</DialogDescription>
        </DialogHeader>
        <section className="space-y-1" aria-labelledby="rating-guide-rating">
          <h3 id="rating-guide-rating" className="font-semibold">
            {ratingGuide.ratingHeading}
          </h3>
          <ol className="divide-y divide-border">
            {ratingGuide.ratingHints.map((row) => (
              <li key={row.value} className="flex items-center gap-3 py-2">
                <span className="w-4 shrink-0 text-right font-bold tabular-nums">
                  {row.value}
                </span>
                <Stars count={row.value} />
                <span className="min-w-0 wrap-anywhere">{row.hint}</span>
              </li>
            ))}
          </ol>
        </section>
        <section
          className="space-y-1"
          aria-labelledby="rating-guide-difficulty"
        >
          <h3 id="rating-guide-difficulty" className="font-semibold">
            {ratingGuide.difficultyHeading}
          </h3>
          <Difficulty />
        </section>
      </DialogContent>
    </Dialog>
  );
}
