'use strict';

// Versioned, fixed vocabulary. Display names never change the model prompt.
// Add styles here (not user recommendation tags); bump version when prompts change.
var SONG_GENE_CATALOG_VERSION = 'styles-v1';
var SONG_GENE_STYLES = [
  ['流行', 'Pop'], ['华语流行', 'Mandopop'], ['粤语流行', 'Cantopop'], ['日语流行', 'J-pop'], ['韩语流行', 'K-pop'],
  ['独立流行', 'Indie pop'], ['梦幻流行', 'Dream pop'], ['合成器流行', 'Synth pop'], ['艺术流行', 'Art pop'], ['卧室流行', 'Bedroom pop'],
  ['民谣流行', 'Folk pop'], ['舞曲流行', 'Dance pop'], ['流行摇滚', 'Pop rock'], ['流行朋克', 'Pop punk'], ['城市流行', 'City pop'],
  ['摇滚', 'Rock'], ['经典摇滚', 'Classic rock'], ['独立摇滚', 'Indie rock'], ['另类摇滚', 'Alternative rock'], ['硬摇滚', 'Hard rock'],
  ['迷幻摇滚', 'Psychedelic rock'], ['前卫摇滚', 'Progressive rock'], ['后摇', 'Post rock'], ['数学摇滚', 'Math rock'], ['车库摇滚', 'Garage rock'],
  ['布鲁斯摇滚', 'Blues rock'], ['民谣摇滚', 'Folk rock'], ['放克摇滚', 'Funk rock'], ['哥特摇滚', 'Gothic rock'], ['盯鞋', 'Shoegaze'],
  ['垃圾摇滚', 'Grunge'], ['朋克', 'Punk rock'], ['后朋克', 'Post punk'], ['硬核朋克', 'Hardcore punk'], ['情绪摇滚', 'Emo rock'],
  ['重金属', 'Heavy metal'], ['激流金属', 'Thrash metal'], ['死亡金属', 'Death metal'], ['黑金属', 'Black metal'], ['力量金属', 'Power metal'],
  ['交响金属', 'Symphonic metal'], ['前卫金属', 'Progressive metal'], ['厄运金属', 'Doom metal'], ['新金属', 'Nu metal'], ['金属核', 'Metalcore'],
  ['电子', 'Electronic'], ['氛围电子', 'Ambient electronic'], ['实验电子', 'Experimental electronic'], ['智能舞曲', 'Intelligent dance music IDM'], ['电音舞曲', 'Electronic dance music EDM'],
  ['浩室', 'House'], ['深浩室', 'Deep house'], ['科技浩室', 'Tech house'], ['前卫浩室', 'Progressive house'], ['热带浩室', 'Tropical house'],
  ['酸性浩室', 'Acid house'], ['科技舞曲', 'Techno'], ['极简科技', 'Minimal techno'], ['底特律科技', 'Detroit techno'], ['硬科技', 'Hard techno'],
  ['迷幻舞曲', 'Trance'], ['前卫迷幻', 'Progressive trance'], ['精神迷幻', 'Psytrance'], ['碎拍', 'Breakbeat'], ['鼓打贝斯', 'Drum and bass'],
  ['丛林', 'Jungle music'], ['液态鼓打贝斯', 'Liquid drum and bass'], ['回响贝斯', 'Dubstep'], ['未来贝斯', 'Future bass'], ['电子陷阱', 'Electronic trap'],
  ['英国车库', 'UK garage'], ['双步车库', '2-step garage'], ['硬派舞曲', 'Hardstyle'], ['迪斯科', 'Disco'], ['新迪斯科', 'Nu disco'],
  ['合成器浪潮', 'Synthwave'], ['蒸汽波', 'Vaporwave'], ['寒潮', 'Chillwave'], ['电气', 'Electro'], ['工业电子', 'Industrial electronic'],
  ['嘻哈', 'Hip hop'], ['经典嘻哈', 'Old school hip hop'], ['爵士说唱', 'Jazz rap'], ['低保真嘻哈', 'Lo-fi hip hop'], ['碎拍嘻哈', 'Boom bap hip hop'],
  ['陷阱说唱', 'Trap hip hop'], ['钻头说唱', 'Drill hip hop'], ['意识说唱', 'Conscious rap'], ['另类嘻哈', 'Alternative hip hop'], ['云说唱', 'Cloud rap'],
  ['放克说唱', 'G-funk'], ['格莱姆', 'Grime'], ['节奏布鲁斯', 'Rhythm and blues R&B'], ['当代节奏布鲁斯', 'Contemporary R&B'], ['另类节奏布鲁斯', 'Alternative R&B'],
  ['新灵魂', 'Neo soul'], ['灵魂乐', 'Soul'], ['摩城', 'Motown soul'], ['放克', 'Funk'], ['福音', 'Gospel'],
  ['爵士', 'Jazz'], ['摇摆爵士', 'Swing jazz'], ['比波普', 'Bebop jazz'], ['冷爵士', 'Cool jazz'], ['硬波普', 'Hard bop jazz'],
  ['调式爵士', 'Modal jazz'], ['自由爵士', 'Free jazz'], ['融合爵士', 'Jazz fusion'], ['柔滑爵士', 'Smooth jazz'], ['爵士放克', 'Jazz funk'],
  ['拉丁爵士', 'Latin jazz'], ['吉普赛爵士', 'Gypsy jazz'], ['酸性爵士', 'Acid jazz'], ['波萨诺瓦', 'Bossa nova'], ['布鲁斯', 'Blues'],
  ['三角洲布鲁斯', 'Delta blues'], ['芝加哥布鲁斯', 'Chicago blues'], ['电声布鲁斯', 'Electric blues'], ['乡村', 'Country'], ['蓝草', 'Bluegrass'],
  ['美式根源', 'Americana'], ['乡村流行', 'Country pop'], ['乡村摇滚', 'Country rock'], ['民谣', 'Folk'], ['独立民谣', 'Indie folk'],
  ['原声民谣', 'Acoustic folk'], ['创作歌手', 'Singer songwriter'], ['凯尔特民谣', 'Celtic folk'], ['弗拉门戈', 'Flamenco'], ['雷鬼', 'Reggae'],
  ['斯卡', 'Ska'], ['配音雷鬼', 'Dub reggae'], ['舞厅雷鬼', 'Dancehall'], ['雷鬼顿', 'Reggaeton'], ['萨尔萨', 'Salsa'],
  ['桑巴', 'Samba'], ['探戈', 'Tango'], ['伦巴', 'Rumba'], ['梅伦格', 'Merengue'], ['昆比亚', 'Cumbia'],
  ['非洲节拍', 'Afrobeat'], ['非洲流行', 'Afrobeats'], ['阿玛皮亚诺', 'Amapiano'], ['高生活', 'Highlife'], ['世界音乐', 'World music'],
  ['阿拉伯音乐', 'Arabic traditional music'], ['印度古典', 'Indian classical music'], ['宝莱坞', 'Bollywood music'], ['中国民乐', 'Chinese traditional instrumental music'], ['国风流行', 'Chinese traditional fusion pop'],
  ['古琴', 'Guqin music'], ['古筝', 'Guzheng music'], ['中国戏曲', 'Chinese opera'], ['日本传统', 'Japanese traditional music'], ['演歌', 'Enka'],
  ['古典', 'Classical music'], ['巴洛克', 'Baroque classical music'], ['古典主义', 'Classical period music'], ['浪漫主义', 'Romantic classical music'], ['当代古典', 'Contemporary classical music'],
  ['极简主义', 'Minimalist classical music'], ['新古典', 'Neoclassical music'], ['交响乐', 'Symphonic orchestral music'], ['室内乐', 'Chamber music'], ['钢琴独奏', 'Solo piano music'],
  ['弦乐四重奏', 'String quartet music'], ['歌剧', 'Opera'], ['合唱', 'Choral music'], ['电影配乐', 'Film score'], ['史诗配乐', 'Epic orchestral soundtrack'],
  ['游戏配乐', 'Video game soundtrack'], ['音乐剧', 'Musical theatre'], ['新世纪', 'New age music'], ['氛围', 'Ambient music'], ['暗黑氛围', 'Dark ambient'],
  ['持续音氛围', 'Drone music'], ['弛放', 'Chillout music'], ['缓拍', 'Downtempo'], ['神游舞曲', 'Trip hop'], ['后古典', 'Post classical music'],
  ['实验音乐', 'Experimental music'], ['噪音', 'Noise music'], ['具体音乐', 'Musique concrete'], ['芯片音乐', 'Chiptune'], ['无伴奏人声', 'A cappella']
].map(function (row, index) {
  return Object.freeze({ value: 'song-gene:' + SONG_GENE_CATALOG_VERSION + ':' + index, label: row[0], english: row[1], prompt: 'This is ' + row[1] + ' music.' });
});
Object.freeze(SONG_GENE_STYLES);
