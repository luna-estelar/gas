grammar Gas

entry Model:
    elements+=TopLevelElement*;

TopLevelElement:
    GlobalDeclaration | TrackDeclaration | TrackStatement | SectionDeclaration | SectionCall;

GlobalDeclaration:
    TempoDeclaration | KeyDeclaration | TimeSignatureDeclaration | GlobalLengthDeclaration | FlavorDeclaration | LevelDeclaration;

TempoDeclaration:
    'tempo' bpm=INT;

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

SectionDeclaration:
    'section' name=Name ':' INDENT items+=SectionItem+ DEDENT;

SectionItem:
    SectionLengthDeclaration | FlavorDeclaration | TrackStatement | BarBlock;

BarBlock:
    'bar' number=INT ':' INDENT commands+=TrackStatement+ DEDENT;

SectionCall:
    section=[SectionDeclaration:Name] '(' ')';

TrackStatement:
    track=[TrackDeclaration:Name] '.' command=TrackCommand;

TrackCommand:
    PlayCommand | StopCommand | FlavorCommand | TimbreCommand | LevelCommand | NotesCommand | MotifCommand;

PlayCommand:
    {infer PlayCommand} 'play';

StopCommand:
    {infer StopCommand} 'stop';

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
    ID | 'bar' | 'bars' | 'effect' | 'extend' | 'flavor' | 'infinite' | 'key' | 'length' |
    'level' | 'loop' | 'lyrics' | 'motif' | 'notes' | 'play' | 'prompt' | 'section' |
    'stop' | 'tempo' | 'theme' | 'time_signature' | 'timbre' | 'track';

LevelNumber returns number:
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
