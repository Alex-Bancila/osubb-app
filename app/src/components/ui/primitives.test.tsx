import * as axe from 'axe-core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { Badge, badgeVariants } from './badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './empty';
import { Field, FieldDescription, FieldLabel } from './field';

describe('focused UI primitives', () => {
  it('connects field guidance to its accessible control', async () => {
    const { container } = render(
      <Field>
        <FieldLabel htmlFor="task-title">Titlul taskului</FieldLabel>
        <input id="task-title" aria-describedby="task-title-help" />
        <FieldDescription id="task-title-help">
          Spune clar ce trebuie făcut.
        </FieldDescription>
      </Field>,
    );

    expect(
      screen.getByRole('textbox', { name: 'Titlul taskului' }),
    ).toHaveAccessibleDescription('Spune clar ce trebuie făcut.');
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('renders neutral role identity and a textual department label', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Profil</CardTitle>
          <CardDescription>Rol și departament</CardDescription>
        </CardHeader>
        <CardContent>
          <Badge>Responsabil</Badge>
          <Badge variant="outline">Educațional</Badge>
        </CardContent>
      </Card>,
    );

    expect(screen.getByText('Responsabil')).toBeVisible();
    expect(screen.getByText('Educațional')).toBeVisible();
    expect(badgeVariants()).toContain('bg-muted');
    expect(badgeVariants()).not.toContain('bg-primary');
  });

  it('announces errors and explains empty results in plain text', () => {
    render(
      <>
        <Alert variant="destructive">
          <AlertTitle>Nu am putut salva</AlertTitle>
          <AlertDescription>Încearcă din nou.</AlertDescription>
        </Alert>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Niciun task</EmptyTitle>
            <EmptyDescription>Taskurile tale vor apărea aici.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nu am putut salvaÎncearcă din nou.',
    );
    expect(screen.getByText('Niciun task')).toBeVisible();
    expect(screen.getByText('Taskurile tale vor apărea aici.')).toBeVisible();
  });
});
