# Editing Reviews

*Users want to be able to edit their reviews. Moderators,
developers, and users want to be able to view previous versions of
reviews.*

At the moment, users cannot edit their reviews. Part of the
reasoning behind this was that a user can always leave a new review
at the same spot if they hitchhike from there again. In the early
days, people would often send an email if they had made a mistake,
but Hitchmap is now too large for that.

The premise of this feature is that edits should be viewable and
easy to moderate, similar to Wikipedia. This will therefore require
more work than a simple CRUD implementation.

# Exclude Own Reviews from the Cache

*Users always want to see the live version of their own reviews.*

Both the front-end and back-end have a cache of all Hitchmap
reviews, including information about how the reviews should be
clustered into markers. The back-end cache exists to reduce the load
on the back-end. The front-end cache exists to keep the website/app
functional when the user is offline. At the moment, logged-in users'
own reviews are also displayed from this cache. This keeps the app
technically simple, but means, for example, that users cannot
immediately see a new review after submitting it. Instead, they see:

> "Success! Thank you for your contribution! Your review will
> appear on the map within [timeframe]"

This was already inconvenient because reviewers could not see their
reviews immediately, but the editing feature makes this even more
problematic because they will not be able to see their edits
immediately either. The solution is therefore for the user to be able
to separately request their own uncached reviews from the backend,
without the backend making assumptions about which front-end version
the user is running. In the UI, the cached reviews from other users
and the user's fresh reviews are displayed one below the other.

When offline, the app should still fall back to the reviews in the
local cache, including for the user's own reviews.

# Multiple Hitchhiking Attempts

*Users want an intuitive way to add multiple hitchhiking
attempts to an existing review. Users want the new information to be
presented clearly at hitchhiking spots.*

At the moment, hitchhikers can only add one destination per
review. As with the first user request, part of the reasoning behind
this was that a user can always leave a new review at the same spot
if they hitchhike from there again.

In practice, almost nobody leaves multiple reviews at a spot, even
though some hitchhikers have used certain spots hundreds of times.
The concept of a "review" discourages this: reviews are
things people normally write once about a subject. It feels a little
boastful to leave three reviews for a spot that has only been
reviewed five times in total. From an information standpoint, this is
obviously a shame. It is often unclear to readers whether a reviewer
wrote their review based on years of experience or a single
hitchhiking attempt.

To make this clearer, we are changing the UI for, and presentation
of, multiple hitchhiking attempts by the same person. Each
hitchhiking spot shows only one review per person. Multiple
hitchhiking attempts can be added to that review.

The specific design is fairly detailed and does not need to be
read in full, but we have included it here for completeness:

- The main flow for adding a new
  hitchhiking spot/review remains the same. This flow produces a
  review and potentially a successful hitchhiking attempt.
- Immediately after adding a review,
  the user is presented with the following actions:
  - Add another experience
  - Edit review
- If the user opens the hitchhiking
  spot again later, their own review appears at the top with the same
  action buttons.
- When the user adds a hitchhiking
  attempt to a review, they see almost the same form as for a new
  review. However, the wording will need to be different for
  hitchhiking attempts: for example, instead of "How do you rate
  this spot?" something like "How do you rate the spot for
  this direction?" Ratings will be optional for additional
  hitchhiking attempts.
- All of a user's input relating to
  a hitchhiking spot is displayed as a single review.
- If a user clicks on a successful
  hitchhiking attempt, the map zooms to that attempt and the
  corresponding dotted route line on the map changes color.
- If a user edits their review, they
  can also edit all of the underlying hitchhiking attempts.
- If a user has added a successful hitchhiking attempt, they
  will always be given the option to add a new review from the place
  they were picked up to. Most hitchhikers have multiple rides in
  succession.

This design involves many UI changes and a lot of interaction with
other elements under the hood. We have discussed possible solutions
at length and believe this is the simplest and most usable one.
However, there is a chance that user testing will show that it still
needs significant refinement, or even that a different solution would
be better. We have taken this uncertainty into account in the
estimated duration of this request.

# Logging Hitchhiking Attempts Without Details

Add a new field to the review form:

> How many times have you hitchhiked from here?

Options: **1, 2–3, 4–6, 7+**.

To compute the average rating of a hitchhiking spot, we
appropriately weigh provided ratings by the hitchhikers' experience.

# Rejected Rides

*Users want to be able to log rides they have rejected. Users
want the new information to be presented clearly.*

In the current setup, it is impossible to add structured
information about rides you rejected, for example because the driver
was going in the opposite direction. A hitchhiker who stands at a
good spot for a long time but is facing the wrong direction may
sometimes be offered as many as 20 rides, which is a goldmine of
information. For hitchhikers who do want to go in that direction,
information about rejected rides is of course extremely useful.

Rejected rides can be added to each hitchhiking attempt:

- Once a hitchhiking attempt has
  been added, the user can also easily add rejected rides with
  destinations in the main-flow form.
- Immediately after adding a review,
  the user is presented with the following action (if a hitchhiking
  attempt has already been added): **Add rides you rejected.**
- Rejected rides are displayed as subordinate to the associated
  hitchhiking attempt.

# Multiple Users on One Hitchhiking Attempt

Users often hitchhike together. Only one of the two needs to add
the hitchhiking attempt and can add the other user to it. If you
click on the username of an added user, you can also see the
hitchhiking attempts that user has been added to.

# Simple Way to Indicate a Failed Hitchhiking Attempt

*Users want to be able to log failed hitchhiking attempts. It is
important that this process is not error-prone.*

The first version of Hitchmap had a prominent checkbox: *Didn't
get a ride*. This was intended to distinguish the situation where a
user simply does not have the time or inclination to add a
destination to a review from the situation where they actually failed
to get a ride. Because the chance of not getting a ride is quite low
(1–2%?), a large proportion of the checkboxes were clicked
accidentally. With limited development capacity and a lot of
incorrect data, it seemed easier at the time to temporarily remove
the checkbox.

The proper solution is to show a checkbox only after the user has
entered a 1- or 2-star rating and no destination. When the *Didn't
get a ride* checkbox is displayed, it should be checked by
default.

# Improve Search and Filter Functionality

*When a user opens a hitchhiking spot while searching, they want
the reviews matching their search query to appear at the top, with
the reviews that do not match the search query below them.*

Hitchmap has many search and filter options, such as date, user,
wind direction, and review text. When filters are active, all
hitchhiking spots with no matching reviews are hidden. At the moment,
the order of reviews within a hitchhiking spot does not change based
on the filters.

We want to extend this by also changing the display of an opened
hitchhiking spot based on the filters. Matching reviews appear at the
top, with non-matching reviews below them under a separate heading.

# Activate Filters from Reviews

*When a review displays a particular attribute (such as a wind
direction the reviewer traveled with), the user wants to activate the
corresponding filter by clicking on that attribute.*

# Styling for Satellite View

*Users want the UI to remain clear and readable when satellite
imagery is enabled.*

Hitchmap's satellite map layer was originally added in an
afternoon at the request of a single hitchhiker, but it has become
one of Hitchmap's most popular features. One reaction to its release
was: "This is all I ever wanted." This came as a surprise,
since every Hitchmap review already has a Google Maps link where
users can easily view satellite imagery. Its popularity is the result
of a combination of factors:

- It is much more convenient to stay
  in the same app while viewing both the reviews and the corresponding
  satellite imagery.
- The high-contrast satellite imagery from Esri, which Hitchmap
  uses, is much better suited to hitchhiking than Google's imagery.
  Unmarked country roads, which are often used to reach a hitchhiking
  spot, are much easier to see.

In any case, many hitchhikers now prefer the satellite layer,
which Hitchmap remembers. These users therefore effectively never see
the standard schematic map layer anymore. The problem is that we have
never styled the website for Esri's high-contrast satellite layer, so
most UI elements on the map are difficult to see. This needs to be
addressed by restyling all elements on the map for this layer.

# Continue Developing the App

Since we receive a location update every 5 seconds from
hitchhiking users who track their rides, we have hundreds of
thousands of points for some users. By next summer, we expect this to
grow to millions. A lot of optimization, indexing, and caching will
be required to handle this.
