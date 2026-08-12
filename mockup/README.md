# OSUBB — Prototip aplicație

Mockup interactiv (clickabil) pentru aplicația OSUBB. HTML/CSS/JS pur, fără build.

## Cum îl deschizi

- **Simplu:** dublu-click pe `index.html`.
- **Recomandat** (pentru fonturi/imagini fără sughițuri pe Chrome): servește local:
  ```bash
  cd mockup
  python -m http.server 8123
  # deschide http://127.0.0.1:8123/index.html
  ```

## Cum îl folosești

1. Pe ecranul de login, orice email/parolă te conectează (e demo).
2. Sus, în bara de titlu, ai un selector **„Vezi ca"** — schimbă rolul
   (Recrut, Voluntar, Voluntar activ, Drept de vot, Responsabil, Membru BC).
   Meniul din stânga se adaptează automat la permisiunile rolului.
3. Click-uiește prin ecrane: Acasă, Task Tracker, Calendar, Anunțuri, Voluntari,
   Profil, Panou BC. Clopoțelul (dreapta sus) deschide notificările.
4. Pe pagina **Profil** ai un buton **🌙 Temă întunecată / ☀️ Temă luminoasă** —
   schimbă tema; alegerea se reține (localStorage).

## Ce conține

Prioritățile de vară (Task Tracker, Conturi/Dashboard, Calendar, Anunțuri, Bază de
date voluntari, Panou BC) plus elemente din planul managerial (gamification, Cupa
departamentelor, recrutare HR). Datele sunt demonstrative.

## Structură

```
index.html              shell aplicație + login
assets/                 logo OSUBB (din brand book)
css/   tokens · base · components · layout
js/    data · icons · state · router · app
js/views/<ecran>.js     câte un ecran
```

Identitate vizuală: roșu `#ED2025` + negru + alb, Montserrat, culori pe departament
din Brand Book OSUBB 2025.
