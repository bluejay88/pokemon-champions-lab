export interface OnlineBattleTrack {
  id: string;
  label: string;
  generation: string;
  audioUrl: string;
  sourceUrl: string;
}

export const battleMusicTracks: OnlineBattleTrack[] = [
  {
    id: 'gen1-gym',
    label: 'Kanto Gym Leader',
    generation: 'Gen I',
    audioUrl: 'https://play.pokemonshowdown.com/audio/bw2-kanto-gym-leader.mp3',
    sourceUrl: 'https://play.pokemonshowdown.com/audio/bw2-kanto-gym-leader.mp3',
  },
  {
    id: 'gen2-champion',
    label: 'Champion Theme',
    generation: 'Gen II - Gold / Silver',
    audioUrl: 'https://downloads.khinsider.com/game-soundtracks/album/pokemon-gold-silver-crystal/101.%20Battle%21%20%28Champion%29.mp3',
    sourceUrl: 'https://downloads.khinsider.com/game-soundtracks/album/pokemon-gold-silver-crystal/101.%20Battle%21%20%28Champion%29.mp3',
  },
  {
    id: 'gen3-colosseum',
    label: 'Colosseum Battle',
    generation: 'Gen III / Colosseum',
    audioUrl: 'https://play.pokemonshowdown.com/audio/colosseum-miror-b.mp3',
    sourceUrl: 'https://play.pokemonshowdown.com/audio/colosseum-miror-b.mp3',
  },
  {
    id: 'gen4-champion',
    label: 'Sinnoh Trainer Battle',
    generation: 'Gen IV',
    audioUrl: 'https://play.pokemonshowdown.com/audio/dpp-trainer.mp3',
    sourceUrl: 'https://play.pokemonshowdown.com/audio/dpp-trainer.mp3',
  },
  {
    id: 'gen5-final',
    label: 'Unova Final Battle',
    generation: 'Gen V',
    audioUrl: 'https://play.pokemonshowdown.com/audio/bw-trainer.mp3',
    sourceUrl: 'https://play.pokemonshowdown.com/audio/bw-trainer.mp3',
  },
  {
    id: 'gen6-online',
    label: 'Kalos Online Battle',
    generation: 'Gen VI',
    audioUrl: 'https://play.pokemonshowdown.com/audio/xy-trainer.mp3',
    sourceUrl: 'https://play.pokemonshowdown.com/audio/xy-trainer.mp3',
  },
  {
    id: 'gen7-ladder',
    label: 'Alola Battle Tree',
    generation: 'Gen VII',
    audioUrl: 'https://play.pokemonshowdown.com/audio/sm-trainer.mp3',
    sourceUrl: 'https://play.pokemonshowdown.com/audio/sm-trainer.mp3',
  },
  {
    id: 'gen8-ranked',
    label: 'Hoenn Rival Battle',
    generation: 'Gen VIII Warmup / ORAS',
    audioUrl: 'https://play.pokemonshowdown.com/audio/oras-rival.mp3',
    sourceUrl: 'https://play.pokemonshowdown.com/audio/oras-rival.mp3',
  },
  {
    id: 'gen8-marnie',
    label: "Marnie's Theme",
    generation: 'Gen VIII - Sword / Shield',
    audioUrl: 'https://downloads.khinsider.com/game-soundtracks/album/pokemon-sword-shield-ost/42%20-%20Marnie%27s%20Theme.mp3',
    sourceUrl: 'https://downloads.khinsider.com/game-soundtracks/album/pokemon-sword-shield-ost/42%20-%20Marnie%27s%20Theme.mp3',
  },
  {
    id: 'gen8-gym-leader',
    label: 'Gym Leader Theme',
    generation: 'Gen VIII - Sword / Shield',
    audioUrl: 'https://downloads.khinsider.com/game-soundtracks/album/pokemon-sword-shield-ost/60%20-%20Battle%21%20%28Gym%20Leader%29.mp3',
    sourceUrl: 'https://downloads.khinsider.com/game-soundtracks/album/pokemon-sword-shield-ost/60%20-%20Battle%21%20%28Gym%20Leader%29.mp3',
  },
  {
    id: 'gen9-tera',
    label: 'Battle Tree Pressure',
    generation: 'Modern Ladder',
    audioUrl: 'https://play.pokemonshowdown.com/audio/bw-subway-trainer.mp3',
    sourceUrl: 'https://play.pokemonshowdown.com/audio/bw-subway-trainer.mp3',
  },
];
