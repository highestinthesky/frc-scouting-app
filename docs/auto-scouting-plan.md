# Interactive auto scouting — the plan

**This is the source document for the feature, written by the person running the
team, and it is reference rather than a working draft.** It is reproduced below
unedited. Where the design record disagrees with it, the design record is what
changed: `docs/adr-002-spatial-observations.md` was originally written without
this document and contradicted it on three load-bearing points — a dragged path,
recording during auto, and the replay. All three were resolved in favour of what
is written here.

`ROADMAP.md` stays the single plan document. This is one of its inputs.

---

## General Gist
- The auto scouting form should exist inside the normal field. 
- Scouts should be able to drag (either on their phone or computer, remember, by the time this is used, we only have website as an option) the robot that they're scouting around their screen. 
- On the sidebar(swappable on the left or right of the screen), scoutings should be able to press down when the robot is collecting, scoring, or disrupted from its original path. 
- The recording should be saved, and after all robots are scouted for, managers should be able to replay the auto of that specific match. 
- Statistics like shooting cycles should be able to be generated from the recorded auto match
- After multiple runs of the same bot, the app should be able to find similar auto paths for the same robot. They should be able to see the general paths that the robot is able to take. 

## Recording
- On screen, the scouts should be able to place a square icon onto the field (The field should be cut, as robots can only enter neutral and alliance regions during auto). Before the match begins, scouts should be able to drag it to the correct starting position. The app (hidden) should be able to classify the starting position. Classify positions by considering the perspective of a member of that team. For example, behind the hub for this season would be considered Middle. 
- The scouts should be able to adjust whether the on-screen field has the alliance field to the left or right, for their positioning. Additionally, they should be able to swap the side bar from the left or right for preference. 
- The side bar should have three buttons - shooting, collecting, and malfunction. Scouts should hold down these buttons when the robot is performing these actions. If scouts click malfunction, they should be prompted to fill out an additional malfunction form on the normal form. 
- Robots should not be able to clip into the walls or the center hub. 

## Analysis
- The auto path of the specific robot should be saved. 
- Statistics like seconds spent scoring, scoring cycles should be able to be answered. 
- Managers should be able to review a specific match, and all of the recorded auto paths should play at once, so managers can basically watch an eagle's eye replay of what happened. 
- In the specific profile of each team, managers should be able to see the general paths that the team is able to use, and the app should be able to determine similar auto paths together. 
- (Reach) Determine compatibility of auto paths with the team's own recorded paths. 

## Limitations
- Due to the fact that the recordings will be saved raw and have to contain 15 seconds worth of a robot's actions, I worry about the database size limitations. 
- Turning auto paths into general words would be very difficult
- Per match and per scout pages need to be built as a prerequisite. 
- Logic for malfunction button needs to be fleshed out

## Future
- Perhaps after recorded most of the auto paths that a team has available, the scouting app would be able to predict the combination of paths that the teams would take
- The above feature would be another add on to the match predictions feature (future). Once statbotics works again, we will combine its data with the team's data to estimate how many points each robot will score. 