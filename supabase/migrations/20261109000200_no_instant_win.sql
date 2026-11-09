-- Every round now goes to the vote, so a unanimous like no longer ends swiping.
drop trigger swipes_resolve on swipes;
drop function resolve_unanimous();
