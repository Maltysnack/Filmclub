-- A round that ends with no votes at all gets one more go instead of a random pick.
-- Usually that means the votes were lost on the way, not that nobody voted.
alter table rounds add column extended boolean not null default false;
