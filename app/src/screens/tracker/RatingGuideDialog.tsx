import { BookOpenIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import { ratingGuide } from './rating-guide-content';

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
          <DialogDescription>{ratingGuide.placeholderNotice}</DialogDescription>
        </DialogHeader>
        {ratingGuide.sections.map((section) => (
          <section key={section.heading} className="space-y-2">
            <h3 className="font-semibold">{section.heading}</h3>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
