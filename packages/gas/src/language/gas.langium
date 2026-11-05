grammar Gas

entry Model:
    elements+=TopLevelElement*;

TopLevelElement:
    GlobalDeclaration | GlobalClear | ReservedStatement | TrackDeclaration | TrackRemoval | TrackStatement |
    SectionDeclaration | SectionCall;

GlobalDeclaration:
    TempoDeclaration | KeyDeclaration | TimeSignatureDeclaration | GlobalLengthDeclaration | FlavorDeclaration | LevelDeclaration;

TempoDeclaration:
    'tempo' bpm=TempoNumber;

KeyDeclaration:
    'key' value=STRING;

TimeSignatureDeclaration:
    'time_signature' numerator=INT '/' denominator=INT;

GlobalLengthDeclaration:
    'length' length=GlobalLength;

GlobalLength:
    {infer FiniteLength} 'bars' bars=INT loop?='loop'? |
    {infer InfiniteLength} 'infinite';

SectionLengthDeclaration:
    'length' length=SectionLength;

SectionLength:
    'bars' bars=INT;

FlavorDeclaration:
    'flavor' value=STRING;

LevelDeclaration:
    'level' value=LevelNumber;

TrackDeclaration:
    'track' name=Name description=STRING;

// Live only: removes an app track.
TrackRemoval:
    'track' name=Name 'clear';

// Live only: hands a global value back to the score.
GlobalClear:
    slot=('tempo' | 'flavor' | 'level') 'clear';

SectionDeclaration:
    'section' name=Name ':' INDENT items+=SectionItem+ DEDENT;

SectionItem:
    SectionLengthDeclaration | FlavorDeclaration | GlobalClear | ReservedStatement | TrackStatement | BarBlock;

BarBlock:
    'bar' number=INT ':' INDENT commands+=BarCommand+ DEDENT;

BarCommand:
    ReservedStatement | TrackStatement;

SectionCall:
    section=[SectionDeclaration:Name] '(' ')';

TrackStatement:
    track=[TrackDeclaration:Name] '.' command=TrackCommand;

TrackCommand:
    PlayCommand | StopCommand | ReleaseCommand | ClearCommand | FlavorCommand | TimbreCommand | LevelCommand |
    NotesCommand | MotifCommand;

ReservedStatement:
    ReservedGlobalStatement | ReservedTrackStatement;

ReservedGlobalStatement:
    command=ReservedGlobalCommand;

ReservedTrackStatement:
    track=[TrackDeclaration:Name] '.' command=ReservedTrackCommand;

ReservedGlobalCommand:
    LyricsReservedCommand | LyricsThemeReservedCommand | EffectReservedCommand | ExtendReservedCommand |
    PromptReservedCommand;

ReservedTrackCommand:
    LyricsReservedCommand | LyricsThemeReservedCommand | EffectReservedCommand | ExtendReservedCommand |
    PromptReservedCommand;

LyricsReservedCommand:
    {infer LyricsReservedCommand} 'lyrics' value=STRING?;

LyricsThemeReservedCommand:
    {infer LyricsThemeReservedCommand} 'lyrics' '.' 'theme' value=STRING?;

EffectReservedCommand:
    {infer EffectReservedCommand} 'effect' value=STRING?;

ExtendReservedCommand:
    {infer ExtendReservedCommand} 'extend' value=STRING?;

PromptReservedCommand:
    {infer PromptReservedCommand} 'prompt' value=STRING?;

PlayCommand:
    {infer PlayCommand} 'play';

StopCommand:
    {infer StopCommand} 'stop';

// Live only: hands the track's play state back to the score.
ReleaseCommand:
    {infer ReleaseCommand} 'release';

// Live only: hands one of the track's values back to the score.
ClearCommand:
    {infer ClearCommand} slot=('flavor' | 'timbre' | 'level' | 'notes' | 'motif') 'clear';

FlavorCommand:
    {infer FlavorCommand} 'flavor' value=STRING;

TimbreCommand:
    {infer TimbreCommand} 'timbre' value=STRING;

LevelCommand:
    {infer LevelCommand} 'level' value=LevelNumber;

NotesCommand:
    {infer NotesCommand} 'notes' value=AldaValue;

MotifCommand:
    {infer MotifCommand} 'motif' value=AldaValue;

AldaValue:
    {infer AldaValue} raw=ALDA;

Name returns string:
    ID | 'bar' | 'bars' | 'clear' | 'effect' | 'extend' | 'flavor' | 'infinite' | 'key' | 'length' |
    'level' | 'loop' | 'lyrics' | 'motif' | 'notes' | 'play' | 'prompt' | 'release' | 'section' |
    'stop' | 'tempo' | 'theme' | 'time_signature' | 'timbre' | 'track';

LevelNumber returns number:
    DECIMAL | INT;

TempoNumber returns number:
    DECIMAL | INT;

terminal INDENT: 'synthetic:indent';
terminal DEDENT: 'synthetic:dedent';
terminal ALDA: 'synthetic:alda';

hidden terminal WS: /[\t ]+/;
hidden terminal NL: /[\r\n]+/;
hidden terminal SL_COMMENT: /#[^\n\r]*/;

terminal DECIMAL returns number: /[0-9]+\.[0-9]+/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal INT returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;
