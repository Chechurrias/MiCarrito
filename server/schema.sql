create table if not exists public.products (
  id text primary key,
  name text not null,
  price integer not null,
  image_url text not null
);

create table if not exists public.orders (
  id text primary key,
  total integer not null,
  items jsonb not null,
  created_at timestamptz not null
);

insert into public.products (id, name, price, image_url)
values
  (
    'p1',
    'Camiseta básica',
    45000,
    'https://picsum.photos/seed/camiseta/400'
  ),
  (
    'p2',
    'Jean slim',
    120000,
    'https://picsum.photos/seed/jean/400'
  ),
  (
    'p3',
    'Chaqueta ligera',
    180000,
    'https://picsum.photos/seed/chaqueta/400'
  )
on conflict (id) do update set
  name = excluded.name,
  price = excluded.price,
  image_url = excluded.image_url;
