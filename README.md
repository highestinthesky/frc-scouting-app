# FRC Scouting Application

MADE FOR 3419 ROHAWKS

## Structure

### Scouts
- Scouts can create and edit files, whereas they will be pushed to cloud sync to be transferred to a manager
- Can only edit files that they have created

### Managers
- Same as scouts for scouting functionality
- Can view all entries in _Manager View_, which helps to visualize the best picks

## Architecture 
This website is directly connected to an **unencrypted** Supabase **free** database, meaning that it will shut down and require manual reactivation after a week of inactivity
**However**, stored data should be safe

All entries are connected to an **event tag**, which is what the website uses to request sync and push files

Furthermore, to acquire schedules for each scout, a TBA (The Blue Alliance) API key is **required**, however it is free and one can acquire one by simply logging in

## Developer
This website was made for 3419, and has currently not been deployed for practical use

Created by Haolun Zhang

Email me for any bugs or problems - I will fix them ASAP 

Regular updates will be implemented as the season comes. 
