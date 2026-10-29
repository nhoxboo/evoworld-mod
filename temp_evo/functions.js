game.onDeleteObject = function (object) {
	createObjectFadeOut(object);
	if (object.type==objectType.PLAYER)
	{
		var index = discordAsksArr.indexOf(object.id);
			if(index !== -1)
			{
			discordAsksArr.splice(index, 1);
			refreshDiscordMenu();
			}
	}
}

var eatEffects=[];

// Cosmetic only: snapshots never enter the physics, combat or object update loops.
var soulEchoEffects = [];
var soulEchoLimit = 12;

function soulEchoClamp(value) { return Math.max(0, Math.min(1, value)); }
function soulEchoSmooth(value) { value=soulEchoClamp(value); return value*value*(3-2*value); }

var soulEchoPreparations=Object.create(null);
var soulEchoRendererPreparation=null;

function prepareSoulEchoEffect(name, skin)
{
	var definition=game.objectsDef[name];
	if (!definition || !definition.animations) return Promise.resolve(false);
	skin=skin || 0;
	var key=name+':'+skin;
	if (soulEchoPreparations[key]) return soulEchoPreparations[key];
	var scythe=definition.skill && definition.skill.icon==='skill_scytheAttack';
	var frames=new Set();
	['left','right'].forEach(function(side) {
		var animation=definition.animations[(scythe ? 'attacking_' : 'flapping_')+side] || definition.animations['flying_'+side] || definition.animations[definition.animation];
		if (animation) animation.sprites.forEach(function(frame) {
			var skinned=frame+'_'+skin;
			frames.add(skin && (game.sprites[skinned] || game.spritesToDownload[skinned]) ? skinned : frame);
		});
	});
	// Only the echo's frames are needed; do not download every animation of a skin.
	var pending=Array.from(frames,function(frame) {
		var sprite=game.sprites[frame], download=game.spritesToDownload[frame];
		if (!sprite && download) sprite=game.downloadSprite(frame,download.url,download.params);
		if (!sprite) return Promise.resolve(false);
		// The loader must finish mirroring before the echo uses a shared attack frame.
		// Do not start another decode on that image while its onload handler draws it.
		function isReady() {
			var current=game.sprites[frame];
			return !!(current && current.loaded && current.width>0 && current.height>0);
		}
		if (sprite.loaded) return Promise.resolve(isReady());
		if (sprite.complete && !sprite.naturalWidth) return Promise.resolve(false);
		return new Promise(function(resolve) {
			function finished() {
				sprite.removeEventListener('load',finished);
				sprite.removeEventListener('error',finished);
				resolve(isReady());
			}
			sprite.addEventListener('load',finished);
			sprite.addEventListener('error',finished);
		});
	});
	soulEchoPreparations[key]=Promise.all(pending).then(function(loaded) {
		if (!loaded.length || loaded.indexOf(false)!==-1) { delete soulEchoPreparations[key]; return false; }
		if (!soulEchoRendererPreparation) soulEchoRendererPreparation=new Promise(function(resolve) {
			function warmRenderer() {
				var effect=makeSoulEchoEffect({posX:definition.width,posY:0,
					soulEcho:{name:name,skin:skin,x:0,y:0,width:definition.width,height:definition.height,direction:1,scythe:!!scythe}},0);
				if (!effect) { soulEchoRendererPreparation=null; resolve(false); return; }
				var canvas=document.createElement('canvas');
				canvas.width=420; canvas.height=300;
				var context=canvas.getContext('2d');
				context.translate(190,170);
				var scale=Math.min(420/(definition.width*4),300/(definition.height*3.8));
				context.scale(scale,scale);
				renderSoulEchoEffect(context,effect,400);
				// Pay the one-time canvas/shadow setup during the initial loading screen.
				canvas.toBlob(function() { canvas.width=canvas.height=1; resolve(true); });
			}
			if (typeof requestIdleCallback==='function') requestIdleCallback(warmRenderer,{timeout:500});
			else setTimeout(warmRenderer,0);
		});
		return soulEchoRendererPreparation;
	});
	return soulEchoPreparations[key];
}

function makeSoulEchoEffect(response, now)
{
	var source=response && response.soulEcho;
	if (!source && response && response.stickTo!=null)
	{
		var actor=game.gameObjects[response.stickTo];
		if (!actor || actor.deleted || !actor.position) return null;
		var actorDefinition=game.objectsDef[actor.name];
		source={name:actor.name,skin:actor.skin || 0,
			x:actor.position.x+actor.width/2,y:actor.position.y+actor.height/2,
			width:actor.width,height:actor.height,direction:actor.direction,
			scythe:!!(actorDefinition && actorDefinition.skill && actorDefinition.skill.icon==='skill_scytheAttack')};
	}
	if (!source || !game.objectsDef[source.name]) return null;
	var definition=game.objectsDef[source.name];
	if (![source.x, source.y, response.posX, response.posY, source.width, source.height].every(Number.isFinite) || source.width<=0 || source.height<=0) return null;
	var dx=response.posX-source.x, dy=response.posY-source.y;
	var direction=Math.abs(dx)<1 ? (source.direction===-1 ? -1 : 1) : (dx<0 ? -1 : 1);
	var side=direction===1 ? 'right' : 'left';
	var animations=definition.animations || {};
	var scythe=source.scythe===true && !!animations['attacking_'+side];
	var animation=animations[(scythe ? 'attacking_' : 'flapping_')+side] || animations['flying_'+side] || animations[definition.animation];
	if (!animation || !animation.sprites || !animation.sprites.length) return null;
	var width=Math.min(source.width,600), height=Math.min(source.height,600);
	var size=Math.max(width,height);
	var distance=Math.hypot(dx,dy);
	// Flying echoes start at the killer; only distant scythe kills spawn beside the victim.
	var distantScythe=scythe && distance>size*1.5;
	var reach=size*0.845-width*0.1;
	var fromX=distantScythe ? response.posX-direction*reach : source.x;
	var fromY=distantScythe ? response.posY : source.y;
	var angle=Math.atan2(fromY-response.posY,response.posX-fromX)-(direction===-1 ? Math.PI : 0);
	angle=Math.atan2(Math.sin(angle),Math.cos(angle));
	var playbackRate=1.35;
	var effect={
		name:source.name, skin:source.skin || 0, fromX:fromX, fromY:fromY,
		toX:response.posX, toY:response.posY, width:width, height:height,
		direction:direction, angle:angle, scythe:scythe, sprites:animation.sprites.slice(),
		frameTime:animation.animationFrameTime || 80, startTime:now,
		playbackRate:playbackRate, duration:(scythe ? 1500 : 1250)/playbackRate,
		impactTime:(scythe ? 580 : 930)/playbackRate, particles:[]
	};
	// Fixed particles keep the effect stable at every frame rate; no per-frame spawning.
	for (var i=0;i<22;i++)
		effect.particles.push({angle:i*2.399963, distance:0.3+(i*17%23)/23, delay:(i%7)*0.025, size:1.2+(i%4)*0.65});
	prepareSoulEchoEffect(effect.name,effect.skin);
	return effect;
}

function createSoulEchoEffect(response)
{
	var effect=makeSoulEchoEffect(response,game.time);
	if (!effect) return;
	// Prune even while rendering is paused and bound the cost of simultaneous kills.
	soulEchoEffects=soulEchoEffects.filter(function(item) { return game.time-item.startTime<item.duration; });
	if (soulEchoEffects.length>=soulEchoLimit) soulEchoEffects.shift();
	soulEchoEffects.push(effect);
	return effect;
}

function resetSoulEchoEffects() { soulEchoEffects.length=0; }

function getSoulEchoPose(effect, elapsed)
{
	var age=Math.max(0,elapsed*(effect.playbackRate || 1));
	var reveal=soulEchoSmooth(age/180);
	if (effect.scythe)
	{
		var dissolve=soulEchoSmooth((age-820)/680);
		return {x:effect.fromX, y:effect.fromY,
			scale:1.05+0.2*reveal, rotation:0, opacity:0.58*reveal*(1-dissolve),
			frame:Math.min(effect.sprites.length-1,Math.floor(soulEchoClamp((age-160)/620)*effect.sprites.length))};
	}
	var flight=soulEchoClamp((age-270)/660);
	var travel=flight*flight;
	return {x:effect.fromX+(effect.toX-effect.fromX)*travel,
		y:effect.fromY+(effect.toY-effect.fromY)*travel+Math.sin(travel*Math.PI)*Math.min(100,effect.height*0.45),
		scale:(1.05+0.2*reveal)*(1-Math.pow(travel,0.8))+0.08*travel,
		rotation:effect.angle*soulEchoSmooth((age-80)/250),
		opacity:0.58*reveal*(1-soulEchoSmooth((flight-0.75)/0.25)),
		frame:Math.floor(age/effect.frameTime)%effect.sprites.length};
}

function getSoulEchoSprite(effect, frame)
{
	var name=effect.sprites[frame];
	// Use loaded skin frames independently, even when the remaining frames are loading.
	var sprite=effect.skin && game.sprites[name+'_'+effect.skin];
	if (!sprite || !sprite.loaded) sprite=game.sprites[name];
	if (!sprite || !sprite.loaded || !sprite.width || !sprite.height) return null;
	sprite.lastUsed=game.time;
	return sprite;
}

function drawSoulEchoBody(context, effect, pose, opacity, glow)
{
	if (opacity<=0) return;
	var sprite=getSoulEchoSprite(effect,pose.frame);
	if (!sprite) return;
	context.save();
	context.translate(pose.x-effect.fromX, effect.fromY-pose.y);
	context.rotate(pose.rotation);
	context.globalAlpha=opacity;
	context.shadowColor=glow;
	context.shadowBlur=18;
	var width=effect.width*pose.scale, height=effect.height*pose.scale;
	context.drawImage(sprite,-width/2,-height/2,width,height);
	context.restore();
}

function renderSoulEchoEffect(context,effect,elapsed)
{
	if (elapsed<0 || elapsed>=effect.duration) return;
	var pose=getSoulEchoPose(effect,elapsed);
	var playbackRate=effect.playbackRate || 1;
	var duration=effect.duration*playbackRate, impactTime=effect.impactTime*playbackRate;
	// Keep every authored motion, trail and fade in sync at the faster playback rate.
	elapsed*=playbackRate;
	var size=Math.max(effect.width,effect.height);
	var reveal=soulEchoSmooth(elapsed/150);
	var fade=1-soulEchoSmooth((elapsed-duration*0.5)/(duration*0.5));
	context.save();
	context.globalCompositeOperation='lighter';
	// Warm inner glow and a cold outer halo follow the apparition.
	var haloX=pose.x-effect.fromX, haloY=effect.fromY-pose.y;
	var haloRadius=Math.max(1,size*pose.scale*0.57);
	var halo=context.createRadialGradient(haloX,haloY,0,haloX,haloY,haloRadius);
	halo.addColorStop(0,'rgba(238,255,221,0.22)');
	halo.addColorStop(0.35,'rgba(94,245,236,0.12)');
	halo.addColorStop(0.7,'rgba(123,100,255,0.06)');
	halo.addColorStop(1,'rgba(81,118,255,0)');
	context.fillStyle=halo;
	context.globalAlpha=reveal*fade;
	context.fillRect(haloX-haloRadius,haloY-haloRadius,haloRadius*2,haloRadius*2);
	// Delayed silhouettes follow the same path, independent of the current frame rate.
	for (var echo=3;echo>=1;echo--)
	{
		var previous=getSoulEchoPose(effect,(elapsed-echo*46)/playbackRate);
		drawSoulEchoBody(context,effect,previous,previous.opacity*(0.085-echo*0.016)*fade,'#a593ff');
	}
	context.globalCompositeOperation='source-over';
	drawSoulEchoBody(context,effect,pose,pose.opacity,'#a3fff2');
	context.globalCompositeOperation='lighter';
	drawSoulEchoBody(context,effect,pose,pose.opacity*0.24,'#76efff');
	if (effect.scythe)
	{
		// Luminous crescents follow the enlarged scythe's single sweeping attack.
		var slash=soulEchoClamp((elapsed-290)/570);
		var slashAlpha=Math.sin(slash*Math.PI)*0.85;
		context.save();
		context.translate(haloX,haloY);
		context.scale(effect.direction,0.72);
		context.rotate(-0.65+slash*1.6);
		context.lineCap='round';
		for (var arc=0;arc<3;arc++)
		{
			context.beginPath();
			context.strokeStyle=arc===0 ? '#a499ff' : (arc===1 ? '#79ffed' : '#fff8cf');
			context.globalAlpha=slashAlpha*(arc===0 ? 0.22 : 0.75);
			context.lineWidth=arc===0 ? 14 : (arc===1 ? 5 : 1.6);
			context.arc(0,0,size*(0.82+arc*0.025),-1.55+slash*0.75,0.12+slash*1.1);
			context.stroke();
		}
		context.restore();
	}
	else if (elapsed>270 && elapsed<980)
	{
		// Twin wisps converge on the shrinking apparition.
		context.lineCap='round';
		for (var strand=-1;strand<=1;strand+=2)
		{
			context.beginPath();
			for (var step=0;step<=12;step++)
			{
				var trail=getSoulEchoPose(effect,(elapsed-step*15)/playbackRate);
				var tx=trail.x-effect.fromX;
				var ty=effect.fromY-trail.y+Math.sin(step*0.35)*strand*size*0.12;
				if (!step) context.moveTo(tx,ty); else context.lineTo(tx,ty);
			}
			context.globalAlpha=pose.opacity*0.55;
			context.lineWidth=strand===1 ? 2 : 1;
			context.strokeStyle=strand===1 ? '#a4fff2' : '#cab6ff';
			context.stroke();
		}
	}
	// Particles converge at the captured victim position, even after its removal.
	var impact=soulEchoClamp((elapsed-impactTime)/(duration-impactTime));
	var targetX=effect.toX-effect.fromX, targetY=effect.fromY-effect.toY;
	for (var i=0;i<effect.particles.length;i++)
	{
		var particle=effect.particles[i];
		var life=soulEchoClamp((elapsed/duration-particle.delay)/(1-particle.delay));
		var drift=life*life;
		var radius=size*(0.35+particle.distance*drift*1.2);
		var angle=particle.angle+life*(effect.scythe ? 0.9 : 1.8);
		var px=haloX+Math.cos(angle)*radius;
		var py=haloY+Math.sin(angle)*radius*0.65-size*drift*0.35;
		if (!effect.scythe && elapsed>impactTime)
		{
			px=targetX+Math.cos(angle)*size*impact*particle.distance;
			py=targetY+Math.sin(angle)*size*impact*particle.distance;
		}
		context.globalAlpha=Math.sin(life*Math.PI)*0.8*reveal;
		context.fillStyle=i%3===0 ? '#fff1b9' : (i%3===1 ? '#bcafff' : '#befff3');
		var spark=particle.size*(1-life*0.6);
		context.fillRect(px-spark/2,py-spark*2,spark,spark*4);
		context.fillRect(px-spark*2,py-spark/2,spark*4,spark);
	}
	context.restore();
}

function drawSoulEchoEffects()
{
	var context=game.dynamicContext;
	for (var i=soulEchoEffects.length-1;i>=0;i--)
	{
		var effect=soulEchoEffects[i], elapsed=game.time-effect.startTime;
		if (elapsed<0 || elapsed>=effect.duration) { soulEchoEffects.splice(i,1); continue; }
		var pose=getSoulEchoPose(effect,elapsed);
		var position=game.getRenderPosition(pose.x,pose.y);
		var padding=Math.max(effect.width,effect.height)*3*Math.max(game.scaleX,game.scaleY)*game.zoom;
		var target=game.getRenderPosition(effect.toX,effect.toY);
		if (Math.max(position.x,target.x)+padding<0 || Math.max(position.y,target.y)+padding<0 ||
			Math.min(position.x,target.x)-padding>game.canvas.width || Math.min(position.y,target.y)-padding>game.canvas.height) continue;
		var origin=game.getRenderPosition(effect.fromX,effect.fromY);
		context.save();
		context.translate(origin.x,origin.y);
		context.scale(game.scaleX*game.zoom,game.scaleY*game.zoom);
		renderSoulEchoEffect(context,effect,elapsed);
		context.restore();
	}
}

function isPartyMemberAccountId(accountId)
{
	if (typeof partyState=="undefined" || !partyState.party || !partyState.party.members)
		return false;

	accountId=parseInt(accountId);
	if (!accountId)
		return false;

	for (var i=0;i<partyState.party.members.length;i++)
		if (parseInt(partyState.party.members[i].id)==accountId)
			return true;

	return false;
}

function isPartyMemberObject(object)
{
	if (!object) return false;
	return isPartyMemberAccountId(object.userId);
}

function getObjectSprite(object)
{
	if (!object || !object.animations || !object.animation || !object.animations[object.animation])
		return null;

	var objectSprites=object.animations[object.animation].sprites;
	var spriteName=objectSprites[object.animationFrame % objectSprites.length];

	if (object.skin && game.objectsDef[object.name] && game.objectsDef[object.name].skinsLoaded[object.skin]===true)
		spriteName=spriteName+'_'+object.skin;

	var sprite=game.sprites[spriteName];
	if ((!sprite || !sprite.loaded) && object.animations["none"])
	{
		objectSprites=object.animations["none"].sprites;
		spriteName=objectSprites[object.animationFrame % objectSprites.length];
		sprite=game.sprites[spriteName];
	}

	if (!sprite || !sprite.loaded)
		return null;

	return sprite;
}

function startEatEffect(object, eater)
{
	if (!object || !eater || (object.type!=objectType.FOOD && object.type!=objectType.PLAYER) || eater.type!=objectType.PLAYER)
		return;

	if (!game.isVisible(game.camera, object, game.originalWidth / 2 + 120, game.originalHeight / 2 + 120))
		return;

	var sprite=getObjectSprite(object);
	if (!sprite)
		return;

	eatEffects.push({
		sprite: sprite,
		startTime: game.time,
		duration: 340,
		fromX: object.positionCenter.x,
		fromY: object.positionCenter.y,
		toX: eater.positionCenter.x,
		toY: eater.positionCenter.y,
		eaterId: eater.id,
		width: object.width,
		height: object.height,
		zIndex: object.zIndex
	});

	if (eatEffects.length>60)
		eatEffects.splice(0,eatEffects.length-60);
}

function drawEatEffects()
{
	for (var i=0;i<eatEffects.length;i++)
	{
		var effect=eatEffects[i];
		var progress=(game.time-effect.startTime)/effect.duration;

		if (progress>=1)
		{
			eatEffects.splice(i,1);
			i--;
			continue;
		}

		var eater=game.gameObjects[effect.eaterId];
		var targetX=effect.toX;
		var targetY=effect.toY;

		if (eater && !eater.deleted)
		{
			targetX=eater.positionCenter.x;
			targetY=eater.positionCenter.y;
		}

		var ease=1-Math.pow(1-progress,3);
		var pull=effect.width*0.18*Math.sin(progress*Math.PI);
		var width=effect.width*(1.25-(1.12*ease));
		var height=effect.height*(1.25-(1.12*ease));
		var x=effect.fromX+(targetX-effect.fromX)*ease;
		var y=effect.fromY+(targetY-effect.fromY)*ease+pull;
		var opacity=1-progress*0.85;

		game.drawSpriteFast(effect.sprite, x-width/2, y-height/2, height, width, opacity);
	}
}



game.beforeDrawObject = function (object) {

	/*if (object.type==objectType.PLAYER && $("#scan-players-icon").data('status')=="waiting") //do zmiany .data na var jakis
	{
		object.fillColor="#00e600";
		object.fillColorOpacity=0.9;
	}*/

	if (object.type==objectType.TILE || object.type==objectType.BACKGROUND) return;

	if (object.hitEffect != null)
	if (game.time-object.hitEffect<=500)
	{
	var opacity=(abs(125-(game.time-object.hitEffect))/250)*1.5;
	if (opacity<0.2) opacity=0.2;
	object.opacity=opacity;
	}
	else
	{
	object.opacity=1;
	object.hitEffect=null;
	}

	if (object.type==objectType.PLAYER || object.type==objectType.FOOD || object.type==objectType.EFFECT || object.type==objectType.BOSS || object.type==objectType.BOSSHELPER)
	{
		animateObject(object);
	}

	if (object.isProtected)
		object.opacity=0.5;
}

var flags=[];
var canEatArr=[];
var isFriendOnScreen=false;
game.beforeDrawAllObjects = function(){
	isFriendOnScreen=false;
	canEatArr=[];
	prunePlayerTextCanvasCache();
	drawSpawnTimer(1);
}

game.afterDrawAllObjects = function(){
	let object=game.me;
	
	if (!object.deleted)
	{
		if ((object.hp < 100) || (object.armor > 0))
			{
				var outlineOffset = object.outlineWeight || 0;

				var addYPos = 2*game.scaleY;
				var lineHeight = 9*game.scaleY*game.zoom;
				var outlineWeight = 1.5*game.scaleY*game.zoom;
				var renderPosition = game.getRenderPosition(object.position.x, object.position.y);
				var context = game.dynamicContext;

				var offsetX=0;
				context.save();
				context.fillStyle = 'black';
				context.fillRect(offsetX + renderPosition.x + object.width*game.scaleX*game.zoom*0.1 - outlineWeight,renderPosition.y - object.height * game.scaleY*game.zoom  - outlineOffset - addYPos - lineHeight - outlineWeight, object.width*0.8*game.scaleX*game.zoom + outlineWeight*2, lineHeight+outlineWeight*2);
				
				var color = "#00cc00";
				if (object.hp <= 50)
					color = "#ffff00";
				if (object.hp <= 25)
					color = "#ff0000";

				context.fillStyle = color;
				context.fillRect(offsetX + renderPosition.x + object.width*game.scaleX*game.zoom*0.1,renderPosition.y - object.height * game.scaleY*game.zoom - outlineOffset - addYPos - lineHeight, object.width*0.8*game.scaleX*game.zoom*object.hp / 100 , lineHeight);

				context.restore();
			}

		if (object.armor > 0)
			{
				var outlineOffset = object.outlineWeight || 0;

				var addYPos = (10+2)*game.scaleY*game.zoom;
				var lineHeight = 9*game.scaleY*game.zoom;
				var outlineWeight = 1.5*game.scaleY*game.zoom;
				var renderPosition = game.getRenderPosition(object.position.x, object.position.y);
				var context = game.dynamicContext;

				var offsetX=0;
				context.save();
				context.fillStyle = 'black';
				context.fillRect(offsetX + renderPosition.x + object.width*game.scaleX*game.zoom*0.1 - outlineWeight,renderPosition.y - object.height * game.scaleY*game.zoom  - outlineOffset - addYPos - lineHeight - outlineWeight, object.width*0.8*game.scaleX*game.zoom + outlineWeight*2, lineHeight+outlineWeight*2);
				
				var color = "#00acff";

				context.fillStyle = color;
				context.fillRect(offsetX + renderPosition.x + object.width*game.scaleX*game.zoom*0.1,renderPosition.y - object.height * game.scaleY*game.zoom - outlineOffset - addYPos - lineHeight, object.width*0.8*game.scaleX*game.zoom*object.armor / 100 , lineHeight);

				for (let i = 1; i < 4*object.armor/100; i++) {
					let lineX = offsetX + renderPosition.x + object.width * game.scaleX * game.zoom * 0.1 + (object.width * 0.8 * game.scaleX * game.zoom * (i * 0.25));
					context.fillStyle = 'black';
					context.fillRect(lineX - 1, renderPosition.y - object.height * game.scaleY * game.zoom - outlineOffset - addYPos - lineHeight, 2, lineHeight);
				}

				context.restore();
			}

		if (object.throwableItem && object.throwableItem.count>0)
		{
			var speedX=0;
			var speedY=0;
			if (object.direction==-1)
			{
				speedX=-800;
				if (object.moveSpeed.x<0)
					speedX+=object.moveSpeed.x;
				if (object.moveSpeed.x<-1000)
					speedX=-1000;

				speedY=20+object.moveSpeed.y*2;
			}
			else
			{
				speedX=800;
				if (object.moveSpeed.x>0)
					speedX+=object.moveSpeed.x;
				if (object.moveSpeed.x>1000)
					speedX=1000;

				speedY=20+object.moveSpeed.y*2;
			}

			var startX = object.positionCenter.x;
			var startY = object.positionCenter.y;
			var context = game.dynamicContext;
	

			// Calculate curve points based on gravity and maxDistance
			var points = [];
			var steps = 20;
			var tStep = 0.04; // time step
			var gravity = game.gravity || 1800;
			var vx = speedX, vy = speedY;
			let totalDist = 0;
			let lastX = startX, lastY = startY;
			for (let i = 0; i <= steps; i++) {
				let t = i * tStep;
				let x = startX + vx * t;
				let y = startY + vy * t - 0.5 * gravity * t * t;
				let dist = Math.sqrt((x - lastX) * (x - lastX) + (y - lastY) * (y - lastY));
				totalDist += dist;

				//if (totalDist>object.width/2)
					points.push(game.getRenderPosition(x, y));
				lastX = x;
				lastY = y;
			}

			context.save();
			context.lineWidth = 3;

			// Draw the curve with progressive opacity
			for (let i = 1; i < points.length; i++) {
				const opacity = 0.6 * (i / points.length); // Start from 0, up to 0.2
				context.strokeStyle = `rgba(255, 0, 0, ${opacity})`;
				context.beginPath();
				context.moveTo(points[i - 1].x, points[i - 1].y);
				context.lineTo(points[i].x, points[i].y);
				context.stroke();
			}

			context.restore();
		}

	}
	
	drawSpawnTimer(2);
	drawEatEffects();
	drawSoulEchoEffects();
	drawTextEffects();
	drawHints();

	if (emotesMenuOpened)
	{
		if (isFriendOnScreen)
			$(chatInput).show();
	}
}

var playerTextCanvasCache=Object.create(null);
var playerTextCanvasCacheCount=0;
var playerTextCanvasCacheMaxEntries=512;
var playerTextCanvasCacheMaxIdleTime=10000;
var playerTextCanvasCacheLastPruneTime=0;
var playerTextMeasureCanvas=document.createElement("canvas");
var playerTextMeasureContext=playerTextMeasureCanvas.getContext("2d");

function applyPlayerTextCanvasStyle(context,style)
{
	context.font=style.font || "10px sans-serif";
	context.fillStyle=style.fillStyle || "black";
	context.strokeStyle=style.strokeStyle || "black";
	context.lineWidth=style.lineWidth || 1;
	context.lineJoin=style.lineJoin || "round";
	context.miterLimit=style.miterLimit || 2;
	context.shadowColor=style.shadowColor || "rgba(0,0,0,0)";
	context.shadowOffsetX=style.shadowOffsetX || 0;
	context.shadowOffsetY=style.shadowOffsetY || 0;
	context.shadowBlur=style.shadowBlur || 0;
	context.direction=style.direction || "inherit";
	context.textAlign="left";
	context.textBaseline="alphabetic";
}

function getPlayerTextStyleSignature(text,style)
{
	return JSON.stringify([
		String(text),
		style.font || "",
		style.fillStyle || "",
		style.strokeStyle || "",
		style.lineWidth || 0,
		style.lineJoin || "",
		style.miterLimit || 0,
		style.shadowColor || "",
		style.shadowOffsetX || 0,
		style.shadowOffsetY || 0,
		style.shadowBlur || 0,
		style.direction || ""
	]);
}

function getPlayerTextLayoutSignature(text,style)
{
	return JSON.stringify([
		String(text),
		style.font || "",
		style.strokeStyle ? 1 : 0,
		style.lineWidth || 0,
		style.lineJoin || "",
		style.miterLimit || 0,
		style.shadowBlur || 0,
		style.shadowOffsetX || 0,
		style.shadowOffsetY || 0,
		style.direction || ""
	]);
}

function copyPlayerTextStyle(style)
{
	return {
		font:style.font || "10px sans-serif",
		fillStyle:style.fillStyle || "black",
		strokeStyle:style.strokeStyle || "",
		lineWidth:style.lineWidth || 0,
		lineJoin:style.lineJoin || "",
		miterLimit:style.miterLimit || 0,
		shadowColor:style.shadowColor || "",
		shadowOffsetX:style.shadowOffsetX || 0,
		shadowOffsetY:style.shadowOffsetY || 0,
		shadowBlur:style.shadowBlur || 0,
		direction:style.direction || ""
	};
}

// Compare the saved values directly: cache hits need no signature arrays or JSON strings.
function matchesPlayerTextStyle(style,cachedStyle)
{
	return cachedStyle &&
		cachedStyle.font===(style.font || "10px sans-serif") &&
		cachedStyle.fillStyle===(style.fillStyle || "black") &&
		cachedStyle.strokeStyle===(style.strokeStyle || "") &&
		cachedStyle.lineWidth===(style.lineWidth || 0) &&
		cachedStyle.lineJoin===(style.lineJoin || "") &&
		cachedStyle.miterLimit===(style.miterLimit || 0) &&
		cachedStyle.shadowColor===(style.shadowColor || "") &&
		cachedStyle.shadowOffsetX===(style.shadowOffsetX || 0) &&
		cachedStyle.shadowOffsetY===(style.shadowOffsetY || 0) &&
		cachedStyle.shadowBlur===(style.shadowBlur || 0) &&
		cachedStyle.direction===(style.direction || "");
}

function measurePlayerTextWidth(text,style)
{
	applyPlayerTextCanvasStyle(playerTextMeasureContext,style);
	return playerTextMeasureContext.measureText(String(text)).width;
}

function createLegacyPlayerTextImage(text,style)
{
	text=String(text);
	applyPlayerTextCanvasStyle(playerTextMeasureContext,style);

	var metrics=playerTextMeasureContext.measureText(text);
	var parsedFontSize=parseFloat(style.font) || 10;
	var fontPixelSize=style.font && style.font.indexOf("pt")!==-1 ? parsedFontSize*4/3 : parsedFontSize;
	var ascent=Math.ceil(metrics.actualBoundingBoxAscent || fontPixelSize);
	var descent=Math.ceil(metrics.actualBoundingBoxDescent || fontPixelSize*0.3);
	var actualLeft=Math.ceil(Math.max(0,metrics.actualBoundingBoxLeft || 0));
	var actualRight=Math.ceil(Math.max(metrics.width,metrics.actualBoundingBoxRight || metrics.width));
	var lineWidth=style.strokeStyle ? (Number(style.lineWidth) || 1) : 0;
	var shadowBlur=Number(style.shadowBlur) || 0;
	var shadowOffsetX=Number(style.shadowOffsetX) || 0;
	var shadowOffsetY=Number(style.shadowOffsetY) || 0;
	var horizontalPadding=Math.ceil(2+lineWidth+shadowBlur*2+Math.abs(shadowOffsetX));
	var verticalPadding=Math.ceil(2+lineWidth+shadowBlur*2+Math.abs(shadowOffsetY));
	var canvasWidth=Math.max(1,Math.ceil(actualLeft+actualRight+horizontalPadding*2));
	var canvasHeight=Math.max(1,Math.ceil(ascent+descent+verticalPadding*2));

	var canvas=document.createElement("canvas");
	canvas.width=canvasWidth;
	canvas.height=canvasHeight;
	var context=canvas.getContext("2d");
	applyPlayerTextCanvasStyle(context,style);

	var drawOriginX=horizontalPadding+actualLeft;
	var baselineY=verticalPadding+ascent;
	if (style.strokeStyle && (!style.lineWidth || style.lineWidth>0))
		context.strokeText(text,drawOriginX,baselineY);
	context.fillText(text,drawOriginX,baselineY);

	return {
		image:canvas,
		textWidth:metrics.width,
		drawOriginX:drawOriginX,
		baselineY:baselineY
	};
}

function closePlayerTextImage(image)
{
	if (image && typeof image.close==="function")
	{
		try { image.close(); } catch(error) {}
	}
}

function releasePlayerTextCanvasEntry(entry)
{
	if (!entry) return;
	closePlayerTextImage(entry.image);
	if (entry.image instanceof HTMLCanvasElement)
	{
		entry.image.width=0;
		entry.image.height=0;
	}
	entry.image=null;
}

function installPlayerTextImage(entry,result,signature,layoutSignature)
{
	if (entry.image && entry.image!==result.image)
		closePlayerTextImage(entry.image);

	entry.image=result.image;
	entry.imageSignature=signature;
	entry.imageLayoutSignature=layoutSignature;
	entry.imageTextWidth=Number(result.textWidth) || 0;
	entry.width=entry.imageTextWidth;
	entry.drawOriginX=Number(result.drawOriginX) || 0;
	entry.baselineY=Number(result.baselineY) || 0;
}

function refreshPlayerTextCanvasEntry(cacheKey,entry)
{
	if (!entry || !entry.desiredSignature) return;

	var requestedSignature=entry.desiredSignature;
	var requestedLayoutSignature=entry.desiredLayoutSignature;
	var requestedText=entry.desiredText;
	var requestedStyle=entry.desiredStyle;
	if (playerTextCanvasCache[cacheKey]!==entry || entry.desiredLayoutSignature!==requestedLayoutSignature)
		return;

	// Color animation does not change text bounds. Repaint the same surface without
	// measuring the text again or allocating another canvas/backing store.
	if (entry.image instanceof HTMLCanvasElement && entry.imageLayoutSignature===requestedLayoutSignature)
	{
		var context=entry.image.getContext("2d");
		context.clearRect(0,0,entry.image.width,entry.image.height);
		// Invalid CSS colors retain the context value; match a fresh canvas fallback.
		context.fillStyle="black";
		context.strokeStyle="black";
		context.shadowColor="rgba(0,0,0,0)";
		applyPlayerTextCanvasStyle(context,requestedStyle);
		if (requestedStyle.strokeStyle && (!requestedStyle.lineWidth || requestedStyle.lineWidth>0))
			context.strokeText(requestedText,entry.drawOriginX,entry.baselineY);
		context.fillText(requestedText,entry.drawOriginX,entry.baselineY);
		entry.imageSignature=requestedSignature;
		return;
	}

	var image=createLegacyPlayerTextImage(requestedText,requestedStyle);
	installPlayerTextImage(entry,image,requestedSignature,requestedLayoutSignature);
}

function prunePlayerTextCanvasCache()
{
	if (game.time-playerTextCanvasCacheLastPruneTime<1000) return;
	playerTextCanvasCacheLastPruneTime=game.time;

	for (var key in playerTextCanvasCache)
	{
		var entry=playerTextCanvasCache[key];
		if (game.time-entry.lastUsed>=playerTextCanvasCacheMaxIdleTime)
		{
			releasePlayerTextCanvasEntry(entry);
			delete playerTextCanvasCache[key];
			playerTextCanvasCacheCount--;
		}
	}

	if (playerTextCanvasCacheCount<=playerTextCanvasCacheMaxEntries) return;

	var entries=[];
	for (var key in playerTextCanvasCache)
		entries.push({key:key,lastUsed:playerTextCanvasCache[key].lastUsed});
	entries.sort(function(a,b){ return a.lastUsed-b.lastUsed; });
	var removeCount=playerTextCanvasCacheCount-Math.floor(playerTextCanvasCacheMaxEntries*0.75);
	for (var i=0;i<removeCount && i<entries.length;i++)
	{
		releasePlayerTextCanvasEntry(playerTextCanvasCache[entries[i].key]);
		delete playerTextCanvasCache[entries[i].key];
		playerTextCanvasCacheCount--;
	}
}

function getPlayerTextCanvasEntry(cacheKey,text,style)
{
	prunePlayerTextCanvasCache();

	text=String(text);
	var entry=playerTextCanvasCache[cacheKey];
	if (!entry)
	{
		entry={
			image:null,
			imageSignature:null,
			imageLayoutSignature:null,
			imageTextWidth:0,
			drawOriginX:0,
			baselineY:0,
			desiredSignature:null,
			desiredLayoutSignature:null,
			desiredText:"",
			desiredStyle:null,
			width:0,
			lastUsed:game.time
		};
		playerTextCanvasCache[cacheKey]=entry;
		playerTextCanvasCacheCount++;
	}

	if (entry.desiredText!==text || !matchesPlayerTextStyle(style,entry.desiredStyle))
	{
		entry.desiredSignature=getPlayerTextStyleSignature(text,style);
		entry.desiredLayoutSignature=getPlayerTextLayoutSignature(text,style);
		entry.desiredText=text;
		entry.desiredStyle=copyPlayerTextStyle(style);
		refreshPlayerTextCanvasEntry(cacheKey,entry);
	}

	entry.lastUsed=game.time;
	return entry;
}

function drawCachedPlayerText(cacheKey,text,posX,posY,style,opacity)
{
	if (typeof opacity==="undefined") opacity=1;
	if (opacity<=0) return {width:0};

	var entry=getPlayerTextCanvasEntry(cacheKey,text,style);
	if (!entry.image || entry.imageLayoutSignature!==entry.desiredLayoutSignature)
	{
		game.drawText(text,posX,posY,style,opacity);
		return {width:entry.width};
	}

	var renderPosition=game.getRenderPosition(posX,posY);
	var alignOffset=0;
	if (style.textAlign==="center")
		alignOffset=entry.imageTextWidth/2;
	else if (style.textAlign==="right" || style.textAlign==="end")
		alignOffset=entry.imageTextWidth;

	var context=game.dynamicContext;
	context.save();
	context.globalAlpha=opacity;
	context.shadowColor="rgba(0,0,0,0)";
	context.drawImage(
		entry.image,
		renderPosition.x-alignOffset-entry.drawOriginX,
		renderPosition.y-entry.baselineY
	);
	context.restore();

	return {width:entry.width};
}

game.afterDrawObject = function (object) {

 	var lineHeight = 0;
	var outlineWeight = 0;
	var outlineOffset = object.outlineWeight || 0;
	var addYPos = 0;

	var me=object==game.me;
	var offsetX=0;
	if (object.type!=objectType.TILE && object.type!=objectType.TILE)
	{
		if (((object.hp < 100) || (object.armor > 0)) && object.opacity>0)
		{
			addYPos = 2*game.scaleY*game.zoom;
			var lineHeight = 9*game.scaleY*game.zoom;
			var outlineWeight = 1.5*game.scaleY*game.zoom;
			if (!me)
			{
				var renderPosition = game.getRenderPosition(object.position.x, object.position.y);

				var context = game.dynamicContext;

				

				context.save();

				context.globalAlpha = object.opacity;
			
				context.fillStyle = 'black';
				context.fillRect(renderPosition.x + object.width*game.scaleX*game.zoom*0.1 - outlineWeight,renderPosition.y - object.height * game.scaleY*game.zoom  - outlineOffset - addYPos - lineHeight - outlineWeight, object.width*0.8*game.scaleX*game.zoom + outlineWeight*2, lineHeight+outlineWeight*2);
				
				var color = "#00cc00";
				if (object.hp <= 50)
					color = "#ffff00";
				if (object.hp <= 25)
					color = "#ff0000";

				context.fillStyle = color;
				context.fillRect(renderPosition.x + object.width*game.scaleX*game.zoom*0.1,renderPosition.y - object.height * game.scaleY*game.zoom - outlineOffset - addYPos - lineHeight, object.width*0.8*game.scaleX*game.zoom*object.hp / 100 , lineHeight);

				context.restore();
			}
		}
		if (object.armor > 0 && object.opacity>0)
			{
				addYPos = (11+2)*game.scaleY*game.zoom;
				var lineHeight = 9*game.scaleY*game.zoom;
				var outlineWeight = 1.5*game.scaleY*game.zoom;
				if (!me)
				{
					var renderPosition = game.getRenderPosition(object.position.x, object.position.y);
					var context = game.dynamicContext;
					context.save();
	
					context.globalAlpha = object.opacity;
				
					context.fillStyle = 'black';
					context.fillRect(renderPosition.x + object.width*game.scaleX*game.zoom*0.1 - outlineWeight,renderPosition.y - object.height * game.scaleY*game.zoom  - outlineOffset - addYPos - lineHeight - outlineWeight, object.width*0.8*game.scaleX*game.zoom + outlineWeight*2, lineHeight+outlineWeight*2);
					
					var color = "#00acff";
	
					context.fillStyle = color;
					context.fillRect(offsetX + renderPosition.x + object.width*game.scaleX*game.zoom*0.1,renderPosition.y - object.height * game.scaleY*game.zoom - outlineOffset - addYPos - lineHeight, object.width*0.8*game.scaleX*game.zoom*object.armor / 100 , lineHeight);
	
					for (let i = 1; i < 4*object.armor/100; i++) {
						let lineX = offsetX + renderPosition.x + object.width * game.scaleX * game.zoom * 0.1 + (object.width * 0.8 * game.scaleX * game.zoom * (i * 0.25));
						context.fillStyle = 'black';
						context.fillRect(lineX - 1, renderPosition.y - object.height * game.scaleY * game.zoom - outlineOffset - addYPos - lineHeight, 2, lineHeight);
					}
	
					context.restore();
					
				}
			}
	}
	
	if (object.type==objectType.PLAYER || object.type==objectType.PET || object.type==objectType.MISC)
	{
		var nickWidth=0;
		if (object.nick && object.opacity>0 && (object.inBattleRoyaleZone!==true || object==game.me))
		{	
			var partyNick=isPartyMemberObject(object);
			var nickFillStyle=partyNick ? "#4cff6d" : "black";
			var style={};
			if (object.premium>=1)
			{
				style.fillStyle = nickFillStyle;
				style.font = "bold "+13*game.fontScale*game.zoom+"pt monospace";
			}
			else
			{
				style.fillStyle = nickFillStyle;
				style.font = 11*game.fontScale*game.zoom+"pt monospace";
			}
			if (partyNick)
			{
				style.strokeStyle = "rgba(0,0,0,0.85)";
				style.lineWidth = Math.max(2,2*game.zoom);
			}
			style.textAlign="center"; 

			var nickCacheKey="playerNick:"+(object.premium>=1 ? 1 : 0)+":"+(partyNick ? 1 : 0)+":"+object.nick;
			nickWidth=drawCachedPlayerText(nickCacheKey,object.nick,object.position.x+object.width/2,object.position.y+object.height+(lineHeight+outlineWeight*2+outlineOffset+addYPos+3)*1/game.scaleY/game.zoom,style,object.opacity).width;
		
			nickWidth*=1/game.scaleX/game.zoom;
			
			if(nickWidth>300)
				object.nick=truncateNickByWidth(object.nick,{maxWidth: 300, font: style.font});

			

			var lColor;
			var level=object.level;
			var levelAnimationBucket=level>=30 ? Math.floor(game.time/100) : 0;
			var levelAnimationTime=levelAnimationBucket*100;
			if (level<=0)
				lColor="grey"; //grey
			else if (level<=3)
				lColor="#10abff"; //blue	
			else if(level<=6)
				lColor="#038f01"; //green
			else if(level<=9)
				lColor="#e8cf46"; //yellow
			else if(level<=12)
				lColor="#e67300"; //orange
			else if(level<=15)
				lColor="red"; //red
			else if(level<20)
				lColor="#6633cc"; //purple
			else if (level<25)
				lColor="#ff00ff"; //pink
			else if (level<30)
				lColor="white";
			else if (level<35)
			{
				var frequency = levelAnimationTime/400;
				var red   = Math.sin(frequency) * 127 + 128;
				var green = Math.sin(frequency + 2) * 127 + 128;
				var blue  = Math.sin(frequency + 4) * 127 + 128;
				lColor='rgb(' + Math.round(red) + ',' + Math.round(green) + ',' + Math.round(blue) + ')';
			}
			else if (level<40)
			{
				var frequency = levelAnimationTime/600;
				var red   = Math.sin(frequency) * 110 + 130;
				var green = Math.sin(frequency) * 110 + 130;
				var blue  = Math.sin(frequency) * 110 + 130;
				lColor='rgb(' + Math.round(red) + ',' + Math.round(green) + ',' + Math.round(blue) + ')';
			
				var sparkColor='rgb(' + Math.round(abs(red-200)) + ',' + Math.round(abs(green-200)) + ',' + Math.round(abs(blue-200)) + ')';
			
				var sparkY=-1+((level*37+levelAnimationBucket*17)%101)/50;
			}
			else if (level<45)
			{
				var frequency = levelAnimationTime/800;
				var red   = 255;
				var green = abs(Math.sin(frequency)) * 255 ;
				var blue  = 0;
				lColor='rgb(' + Math.round(red) + ',' + Math.round(green) + ',' + Math.round(blue) + ')';
				var sparkColor='rgba(' + Math.round(red) + ',' + 0 + ',' + Math.round(blue) + ', 1)';
			
				var sparkY=-1+((level*37+levelAnimationBucket*17)%101)/50;
				//var sparkX=-0.5+1.5*Math.random();
				//var sparkX=0;
			}
			else if (level<50)
			{
				var frequency = levelAnimationTime/300;
				var red   = Math.sin(frequency) * 110 + 140;
				var green = -Math.sin(frequency) * 130 + 82;
				var blue  = Math.sin(frequency) * 0 + 255;
				lColor='rgb(' + Math.round(red) + ',' + Math.round(green) + ',' + Math.round(blue) + ')';
				var sparkColor='rgba(' + Math.round(abs(red/3)) + ',' + Math.round(abs(green/3)) + ',' + Math.round(abs(blue/3)) + ', 0.9)';
				var sparkY=-1+((level*37+levelAnimationBucket*17)%101)/50;
			}
			
			else if (level<55)
			{
				var frequency = levelAnimationTime/300;
				var red   = 0;
				var green =  Math.sin(frequency) * 255 + 200;
				var blue  = 0;
				lColor='rgb(' + Math.round(red) + ',' + Math.round(green) + ',' + Math.round(blue) + ')';
				var sparkColor='rgba(' + Math.round((red/2)) + ',' + Math.round((green/3)) + ',' + Math.round((blue/3)) + ', 0.9)';
				var sparkY=-1+((level*37+levelAnimationBucket*17)%101)/50;
			}
			else if (level<60)
			{
				var frequency = levelAnimationTime/200;
				var red   = Math.sin(frequency) * 255 + 200;
				var green =  0;
				var blue  = 0;
				lColor='rgb(' + Math.round(red) + ',' + Math.round(green) + ',' + Math.round(blue) + ')';
				var sparkColor='rgba(' + Math.round((red/2)) + ',' + Math.round((green/3)) + ',' + Math.round((blue/3)) + ', 0.9)';
				var sparkY=-1+((level*37+levelAnimationBucket*17)%101)/50;
			}
			else if (level<999)
			{
				var colorProgress=((levelAnimationTime/600)%(Math.PI*2))/(Math.PI*2)*4;
				var colorMix=colorProgress-Math.floor(colorProgress);
				colorMix=(1-Math.cos(colorMix*Math.PI))/2;
				if (colorProgress<1)
				{
					var red=181+(255-181)*colorMix;
					var green=18+(255-18)*colorMix;
					var blue=145+(55-145)*colorMix;
					var sparkRed=102+(255-102)*colorMix;
					var sparkGreen=145*colorMix;
					var sparkBlue=160+(0-160)*colorMix;
				}
				else if (colorProgress<2)
				{
					var red=255+(15-255)*colorMix;
					var green=255+(43-255)*colorMix;
					var blue=55+(187-55)*colorMix;
					var sparkRed=255+(0-255)*colorMix;
					var sparkGreen=145+(98-145)*colorMix;
					var sparkBlue=255*colorMix;
				}
				else if (colorProgress<3)
				{
					var red=15+(250-15)*colorMix;
					var green=43+(250-43)*colorMix;
					var blue=187+(250-187)*colorMix;
					var sparkRed=178*colorMix;
					var sparkGreen=98+(178-98)*colorMix;
					var sparkBlue=255+(210-255)*colorMix;
				}
				else
				{
					var red=250+(181-250)*colorMix;
					var green=250+(18-250)*colorMix;
					var blue=250+(145-250)*colorMix;
					var sparkRed=178+(102-178)*colorMix;
					var sparkGreen=178+(0-178)*colorMix;
					var sparkBlue=210+(160-210)*colorMix;
				}
				lColor='rgb(' + Math.round(red) + ',' + Math.round(green) + ',' + Math.round(blue) + ')';
				var sparkColor='rgba(' + Math.round(sparkRed) + ',' + Math.round(sparkGreen) + ',' + Math.round(sparkBlue) + ', 0.9)';
				var sparkY=-1+((level*37+levelAnimationBucket*17)%101)/50;
			}
			else
			{
				var frequency = levelAnimationTime/65;
				var red   = Math.sin(frequency) * 55 + 200;
				var green = Math.sin(frequency) * 55 + 200;
				var blue  = 0;
				lColor='rgb(' + Math.round(red) + ',' + Math.round(green) + ',' + Math.round(blue) + ')';
				var sparkColor='rgb(' + Math.round(abs(red-155)) + ',' + Math.round(abs(green-155)) + ',' + 0 + ')';
			
				var sparkY=-1+((level*37+levelAnimationBucket*17)%101)/50;
			}


			style={};
			if (level>=35)
			{
			style.font = "900 "+(7.5)*game.fontScale*game.zoom+"pt arial";
			}
			else
			style.font = "bold "+(7.5)*game.fontScale*game.zoom+"pt arial";


			style.textAlign="right";

			style.fillStyle = lColor;

			if (level>=35)
			{
				style.shadowColor=sparkColor;
				style.shadowOffsetY=sparkY;
				style.shadowBlur=4+(level+levelAnimationBucket)%3;
			}

			var levelCacheKey="playerLevel:"+level;
			var levelWidth=drawCachedPlayerText(levelCacheKey,"["+level+"]",object.position.x+object.width/2-nickWidth/2-1,1+object.position.y+object.height+(lineHeight+outlineWeight*2+outlineOffset+addYPos+3)*1/game.scaleY/game.zoom,style,object.opacity).width;


			levelWidth*=1/game.scaleX/game.zoom;
			
			
			for (var i=0;i<leaderboard.length && i<3;i++)
				if (object.id==leaderboard[i].objectId)
					game.drawSpriteFast(leaderboardStars[i+1],object.position.x+object.width/2-nickWidth/2-1-levelWidth-12*1/game.fontScale,1+object.position.y+object.height+(lineHeight+outlineWeight*2+outlineOffset+addYPos+1)*1/game.scaleY/game.zoom,12*1/game.fontScale,12*1/game.fontScale,object.opacity);
			

			if(object.countryCode && object.opacity>0)
			{
				if (!flags[object.countryCode])
				{
				flags[object.countryCode]=new Image;
				flags[object.countryCode].crossOrigin = "Anonymous";
				flags[object.countryCode].src=cdnServer+'/flags/'+object.countryCode.toLowerCase()+'.png';
				}

				if (flags[object.countryCode].width>0)
				{

				var flagOpacity=object.opacity;

				if (flagOpacity>0.5)
				flagOpacity-=0.2;

				game.drawSpriteFast(flags[object.countryCode],object.position.x+object.width/2+nickWidth/2+4,1+object.position.y+object.height+(lineHeight+outlineWeight*2+outlineOffset+addYPos+1)*1/game.scaleY/game.zoom,9*1/game.fontScale,13*1/game.fontScale,flagOpacity);
				
				offsetX+=15*1/game.fontScale;
			}
			}

			if (object.userId==1)
				isFriendOnScreen=true; // chat with developer

			if (friendsArr[object.userId])
				{
					game.drawSpriteFast(friendImage,object.position.x+object.width/2+nickWidth/2+4+offsetX,1+object.position.y+object.height+(lineHeight+outlineWeight*2+outlineOffset+addYPos)*1/game.scaleY/game.zoom-3*1/game.fontScale,16*1/game.fontScale,16*1/game.fontScale,object.opacity);
					offsetX+=18*1/game.fontScale;

					isFriendOnScreen=true;
				}

			if (object.premium)
				{
					game.drawSpriteFast(premiumImage,object.position.x+object.width/2+nickWidth/2+4+offsetX,1+object.position.y+object.height+(lineHeight+outlineWeight*2+outlineOffset+addYPos+1)*1/game.scaleY/game.zoom-3*1/game.fontScale,18*1/game.fontScale,18*1/game.fontScale,object.opacity);
					offsetX+=20*1/game.fontScale;
				}


			if (object.spawnTimer)
				{
					offsetX-=1;
					game.drawSpriteFast(spawnTimerImage,object.position.x+object.width/2+nickWidth/2+4+offsetX,1+object.position.y+object.height+(lineHeight+outlineWeight*2+outlineOffset+addYPos)*1/game.scaleY/game.zoom-3*1/game.fontScale,20*1/game.fontScale,20*1/game.fontScale,object.opacity);
					offsetX+=22*1/game.fontScale;
					offsetX-=1;
				}

			if (object.expBoosterPercent && expBoosterImages[object.expBoosterPercent])
				{
					game.drawSpriteFast(expBoosterImages[object.expBoosterPercent],object.position.x+object.width/2+nickWidth/2+4+offsetX,1+object.position.y+object.height+(lineHeight+outlineWeight*2+outlineOffset+addYPos)*1/game.scaleY/game.zoom-3*1/game.fontScale,18*1/game.fontScale,18*1/game.fontScale,object.opacity);
					offsetX+=20*1/game.fontScale;
				}

			if (object.askedDiscord===true)
			{
				game.drawSpriteFast(discordAskImage,object.position.x+object.width/2+nickWidth/2+4+offsetX,1+object.position.y+object.height+(lineHeight+outlineWeight*2+outlineOffset+addYPos)*1/game.scaleY/game.zoom-3*1/game.fontScale,16*1/game.fontScale,16*1/game.fontScale,object.opacity);
				offsetX+=18*1/game.fontScale;
			}
	}


	if(object.arenaFrags && object.opacity>0)
			{
				style={};
				style.font = "bold "+(13)*game.fontScale*game.zoom+"pt arial";

				style.fillStyle = "red";

				if (object.inBattleRoyaleZone!==true || object==game.me)
				offsetX+=5;
				else
				{
					addYPos+=5;	
					offsetX-=25;
				}
				var fragsWidth=game.drawText(object.arenaFrags,object.position.x+object.width/2+nickWidth/2+4+offsetX,1+object.position.y+object.height+(lineHeight+outlineWeight*2+outlineOffset+addYPos)*1/game.scaleY/game.zoom,style,object.opacity).width;
				offsetX+=fragsWidth*1/game.fontScale/game.zoom;

				game.drawSpriteFast(arenaFragImage,object.position.x+object.width/2+nickWidth/2+6+offsetX,1+object.position.y+object.height+(lineHeight+outlineWeight*2+outlineOffset+addYPos-2)*1/game.scaleY/game.zoom-3*1/game.fontScale,28*1/game.fontScale,28*1/game.fontScale,object.opacity);
			}

	if (object.emote && object.opacity>0 && object.emoteStartTime<game.time)
	{
		var style={};
		var lifetime=game.time-object.emoteStartTime;

		if (lifetime>=4000)
			delete object.emote;
		else
		{
			var opacity=1;
			

			if (lifetime<=500)
			opacity=lifetime/500;
			else
			if (lifetime>=3500)
			opacity=(4000-lifetime)/500;

			game.drawSpriteFast(object.emote,object.position.x+object.width/2-18*1/game.fontScale,object.position.y+object.height+lineHeight+outlineWeight*2+outlineOffset+addYPos+3+25,36*1/game.fontScale,36*1/game.fontScale,opacity);
			addYPos+=45;
		}
		
	}else if (object.chat && object.opacity>0)
	{
		var style={};
		var lifetime=game.time-object.chatStartTime;

		style.fillStyle = "black";



		style.font = "bold "+13*game.fontScale*game.zoom+"pt monospace";
		style.textAlign="center"; 

		if (isArabic(object.chat))
			style.direction = "rtl";

		var boxWidth=game.measureText(object.chat,style).width;
		var time=4000+boxWidth*10;

		if (lifetime>=time)
			delete object.chat;
		else
		{

			

			var opacity=1;
			if (lifetime<=500)
			opacity=lifetime/500;
			else
			if (lifetime>=time-500)
			opacity=(time-lifetime)/500;

			
			boxWidth=10+boxWidth*1.05;

			var renderPosition = game.getRenderPosition(object.position.x, object.position.y);
			var boxHeight=30;
			var context = game.dynamicContext;
			context.save();
			
			context.fillStyle = 'white';

			if (object.chatCustom)
				context.fillStyle  = "#ffff6a";

			context.globalAlpha = opacity;
			context.roundRect(renderPosition.x + (object.width/2)*game.scaleX*game.zoom - boxWidth/2, renderPosition.y - (boxHeight + (lineHeight+outlineWeight*2+outlineOffset+addYPos+3+25) + object.height)*game.scaleY*game.zoom, boxWidth, boxHeight*game.scaleY*game.zoom, 10).fill(); //.stroke() or .fill()
			context.roundRect(renderPosition.x + (object.width/2)*game.scaleX*game.zoom - boxWidth/2, renderPosition.y - (boxHeight + (lineHeight+outlineWeight*2+outlineOffset+addYPos+3+25) + object.height)*game.scaleY*game.zoom, boxWidth, boxHeight*game.scaleY*game.zoom, 10).stroke(); //.stroke() or .fill()
			
			context.restore();
			game.drawText(object.chat,object.position.x+object.width/2,object.position.y+object.height+(lineHeight+outlineWeight*2+outlineOffset+addYPos+3+25+boxHeight/2 - 5),style,opacity);
			addYPos+=40;
		}
		
	}
	else if(object.typing && object.opacity>0 && friendsArr[object.userId] && object.inBattleRoyaleZone!==true)
		{
			style={};
			style.font = "bold "+(13)*game.fontScale*game.zoom+"pt arial";
			
			style.fillStyle = "red";
			let index=1+(floor(game.time/80)%19);
			let bubbleImage=game.sprites["chat_bubble_"+index];

			game.drawSpriteFast(bubbleImage,object.position.x+object.width/2 - 15,1+object.position.y+object.height+25+(lineHeight+outlineWeight*2+outlineOffset+addYPos-2)*1/game.scaleY/game.zoom-3*1/game.fontScale,45*1/game.fontScale,50*1/game.fontScale,object.opacity);
			addYPos+=55;
		}

	if (object.lootInfo && object.lootInfo.length>0 && object.opacity>0)
		{
			//character.lootInfo.push({name:lootItem.name, amount:lootItem.amount, startTime:game.time, image: image});
	
			// Draw from the top if lifetime less than 5 seconds. when close fadeout and remove from array
			// draw loot items stacked vertically (one under another)
			let drawIndex = 0;
			let spacing = 6 * 1 / game.fontScale; // gap between items
			let baseX = object.position.x + object.width / 2;
			let baseY = 1 + object.position.y + object.height + 25 + (lineHeight + outlineWeight * 2 + outlineOffset + addYPos - 2) * 1 / game.scaleY / game.zoom - 3 * game.fontScale;

			for (let i = 0; i < object.lootInfo.length; i++) {
				let loot = object.lootInfo[i];
				let lifetime = game.time - loot.startTime;
				if (lifetime >= 5000) {
					object.lootInfo.splice(i, 1);
					i--;
					continue;
				}

				// appearing animation for first 1s, fade-out for last 1s
				let opacity = 1;
				if (lifetime < 1000) {
					opacity = lifetime / 1000; // fade in from 0 -> 1 in first 1s
				} else if (lifetime >= 4000) {
					opacity = (5000 - lifetime) / 1000; // fade out during last 1s
				}
				if (opacity < 0) opacity = 0;
				if (opacity > 1) opacity = 1;

				// compute sizes & stacked positions
				let imgSize = 32 * 1 / game.fontScale;
				let imgX = baseX - imgSize / 2;
				let imgY = baseY + drawIndex * (imgSize + spacing);
				let imgCenterY = imgY + imgSize / 2 - 5;

				// draw count to the left of the image
				let style = {};
				style.font = "bold " + (13) * game.fontScale * game.zoom + "pt arial";
				style.fillStyle = "black";
				style.textAlign = "right";

				if (loot.fromDropBonus)
				{
					style.fillStyle = "yellow";
					game.drawText("🍀 "+loot.amount + "x", imgX - 4, imgCenterY, style, opacity);
					game.drawSpriteFast(loot.image, imgX, imgY, imgSize, imgSize, opacity);
					style.textAlign = "left";
					game.drawText("🍀", imgX + imgSize + 4, imgCenterY, style, opacity);
				}
				else
				{
				game.drawText(loot.amount + "x", imgX - 4, imgCenterY, style, opacity);
				game.drawSpriteFast(loot.image, imgX, imgY, imgSize, imgSize, opacity);
				}

				drawIndex++;
			}
		}
	


	if (object.throwableItem && object.throwableItem.count>0 && object.opacity>0)
	{

			var objectSprites=object.animations[object.animation].sprites;
			var sprite_name = objectSprites[object.animationFrame % objectSprites.length];

			if (charactersHandOffsets[object.name] && charactersHandOffsets[object.name][sprite_name] && game.objectsDef[object.throwableItem.name])
			{
				var handOffset=charactersHandOffsets[object.name][sprite_name];

				//game.drawSprite(game.sprites["lava"],object.position.x+handOffset.x*object.width-1,object.position.y+handOffset.y*object.height-1,2,2,{opacity: object.opacity, ignoreOffset:me});


				let itemPositionX=-10;
				let itemPositionY=-24;
				let itemSize=24;


				let direction = sprite_name.indexOf("_right") !== -1 ? 1 : -1;
				if (direction==-1)
					itemPositionX=-14;


				var throwableItemImage=game.sprites[game.objectsDef[object.throwableItem.name].animations[game.objectsDef[object.throwableItem.name].animation].sprites[0]];


				for (let i = object.throwableItem.count-1; i >= 0; i--) {
					// Stack closer and diagonally in reverse order, considering direction
					let diagonalOffset = i * (itemSize * 0.08); // closer stacking
					let offsetX = itemPositionX + (direction === -1 ? -diagonalOffset : diagonalOffset);
					let offsetY = itemPositionY - diagonalOffset;
					let size = itemSize;
					game.drawSpriteFast(
						throwableItemImage,
						object.position.x + handOffset.x * object.width + offsetX,
						object.position.y + handOffset.y * object.height + offsetY,
						size,
						size,
						object.opacity
					);
				}
			}
			
		}

	/*if (object.type==objectType.PET)
		object.owner.visibleTick=game.drawTick;
	else if (object.pet)
		object.pet.visibleTick=game.drawTick;*/

	}
}

//in % of object size
var charactersHandOffsets={
	grimReaper:{
		grimReaper_1_idle_right:{x:151/376,y:109/312},
		grimReaper_2_idle_right:{x:151/376,y:109/312},
		grimReaper_3_idle_right:{x:151/376,y:110/312},
		grimReaper_4_idle_right:{x:150/376,y:111/312},
		grimReaper_5_idle_right:{x:149/376,y:112/312},
		grimReaper_6_idle_right:{x:148/376,y:113/312},

		grimReaper_1_flying_right:{x:148/376,y:119/312},
		grimReaper_2_flying_right:{x:147/376,y:119/312},
		grimReaper_3_flying_right:{x:146/376,y:118/312},
		grimReaper_4_flying_right:{x:145/376,y:118/312},
		grimReaper_5_flying_right:{x:144/376,y:118/312},

		grimReaper_1_attack_right:{x:153/376,y:112/312},
		grimReaper_2_attack_right:{x:151/376,y:110/312},
		grimReaper_3_attack_right:{x:149/376,y:109/312},
		grimReaper_4_attack_right:{x:147/376,y:111/312},
		grimReaper_5_attack_right:{x:147/376,y:116/312},
		grimReaper_6_attack_right:{x:147/376,y:118/312},
		grimReaper_7_attack_right:{x:149/376,y:116/312},
		grimReaper_8_attack_right:{x:151/376,y:114/312},


		////

		grimReaper_1_idle_left:{x:1-151/376,y:109/312},
		grimReaper_2_idle_left:{x:1-151/376,y:109/312},
		grimReaper_3_idle_left:{x:1-151/376,y:110/312},
		grimReaper_4_idle_left:{x:1-150/376,y:111/312},
		grimReaper_5_idle_left:{x:1-149/376,y:112/312},
		grimReaper_6_idle_left:{x:1-148/376,y:113/312},

		grimReaper_1_flying_left:{x:1-148/376,y:119/312},
		grimReaper_2_flying_left:{x:1-147/376,y:119/312},
		grimReaper_3_flying_left:{x:1-146/376,y:118/312},
		grimReaper_4_flying_left:{x:1-145/376,y:118/312},
		grimReaper_5_flying_left:{x:1-144/376,y:118/312},

		grimReaper_1_attack_left:{x:1-153/376,y:112/312},
		grimReaper_2_attack_left:{x:1-151/376,y:110/312},
		grimReaper_3_attack_left:{x:1-149/376,y:109/312},
		grimReaper_4_attack_left:{x:1-147/376,y:111/312},
		grimReaper_5_attack_left:{x:1-147/376,y:116/312},
		grimReaper_6_attack_left:{x:1-147/376,y:118/312},
		grimReaper_7_attack_left:{x:1-149/376,y:116/312},
		grimReaper_8_attack_left:{x:1-151/376,y:114/312},
	},
	pumpkinGhost:{
		pumpkinGhost_1_right:{x:164/416,y:(331-247)/331},
		pumpkinGhost_2_right:{x:164/416,y:(331-245)/331},
		pumpkinGhost_3_right:{x:164/416,y:(331-244)/331},
		pumpkinGhost_4_right:{x:164/416,y:(331-242)/331},
		pumpkinGhost_5_right:{x:164/416,y:(331-241)/331},
		pumpkinGhost_6_right:{x:164/416,y:(331-239)/331},
		pumpkinGhost_7_right:{x:164/416,y:(331-238)/331},
		pumpkinGhost_8_right:{x:164/416,y:(331-239)/331},
		pumpkinGhost_9_right:{x:164/416,y:(331-240)/331},

		pumpkinGhost_1_attack_right:{x:129/416,y:(331-242)/331},
		pumpkinGhost_2_attack_right:{x:122/416,y:(331-234)/331},
		pumpkinGhost_3_attack_right:{x:117/416,y:(331-226)/331},
		pumpkinGhost_4_attack_right:{x:112/416,y:(331-216)/331},
		pumpkinGhost_5_attack_right:{x:109/416,y:(331-206)/331},

		////
		pumpkinGhost_1_left:{x:1-164/416,y:(331-247)/331},
		pumpkinGhost_2_left:{x:1-164/416,y:(331-245)/331},
		pumpkinGhost_3_left:{x:1-164/416,y:(331-244)/331},
		pumpkinGhost_4_left:{x:1-164/416,y:(331-242)/331},
		pumpkinGhost_5_left:{x:1-164/416,y:(331-241)/331},
		pumpkinGhost_6_left:{x:1-164/416,y:(331-239)/331},
		pumpkinGhost_7_left:{x:1-164/416,y:(331-238)/331},
		pumpkinGhost_8_left:{x:1-164/416,y:(331-239)/331},
		pumpkinGhost_9_left:{x:1-164/416,y:(331-240)/331},

		pumpkinGhost_1_attack_left:{x:1-129/416,y:(331-242)/331},
		pumpkinGhost_2_attack_left:{x:1-122/416,y:(331-234)/331},
		pumpkinGhost_3_attack_left:{x:1-117/416,y:(331-226)/331},
		pumpkinGhost_4_attack_left:{x:1-112/416,y:(331-216)/331},
		pumpkinGhost_5_attack_left:{x:1-109/416,y:(331-206)/331},
	},
	ghostlyReaper:{
		ghostlyReaper_1_right:{x:106/300,y:(329-251)/329},
		ghostlyReaper_2_right:{x:105/300,y:(329-251)/329},
		ghostlyReaper_3_right:{x:105/300,y:(329-251)/329},
		ghostlyReaper_4_right:{x:104/300,y:(329-251)/329},
		ghostlyReaper_5_right:{x:103/300,y:(329-250)/329},
		ghostlyReaper_6_right:{x:104/300,y:(329-249)/329},
		ghostlyReaper_7_right:{x:104/300,y:(329-247)/329},
		ghostlyReaper_8_right:{x:105/300,y:(329-245)/329},
		ghostlyReaper_9_right:{x:105/300,y:(329-244)/329},
		ghostlyReaper_10_right:{x:106/300,y:(329-244)/329},
		ghostlyReaper_11_right:{x:106/300,y:(329-245)/329},
		ghostlyReaper_12_right:{x:107/300,y:(329-245)/329},
		ghostlyReaper_13_right:{x:107/300,y:(329-246)/329},
		ghostlyReaper_14_right:{x:107/300,y:(329-247)/329},
		ghostlyReaper_15_right:{x:107/300,y:(329-249)/329},
		ghostlyReaper_16_right:{x:106/300,y:(329-250)/329},
		ghostlyReaper_17_right:{x:106/300,y:(329-251)/329},

		ghostlyReaper_1_attack_right:{x:106/300,y:(329-251)/329},
		ghostlyReaper_2_attack_right:{x:127/300,y:(329-238)/329},
		ghostlyReaper_3_attack_right:{x:142/300,y:(329-219)/329},
		ghostlyReaper_4_attack_right:{x:150/300,y:(329-195)/329},
		ghostlyReaper_5_attack_right:{x:153/300,y:(329-174)/329},
		ghostlyReaper_6_attack_right:{x:150/300,y:(329-152)/329},
		ghostlyReaper_7_attack_right:{x:140/300,y:(329-131)/329},
		ghostlyReaper_8_attack_right:{x:136/300,y:(329-128)/329},
		ghostlyReaper_9_attack_right:{x:131/300,y:(329-126)/329},
		ghostlyReaper_10_attack_right:{x:170/300,y:(329-162)/329},
		ghostlyReaper_11_attack_right:{x:188/300,y:(329-206)/329},
		ghostlyReaper_12_attack_right:{x:162/300,y:(329-242)/329},
		ghostlyReaper_13_attack_right:{x:128/300,y:(329-261)/329},
		ghostlyReaper_14_attack_right:{x:126/300,y:(329-260)/329},
		ghostlyReaper_15_attack_right:{x:123/300,y:(329-260)/329},
		ghostlyReaper_16_attack_right:{x:120/300,y:(329-259)/329},
		////

		ghostlyReaper_1_left:{x:1-106/300,y:(329-251)/329},
		ghostlyReaper_2_left:{x:1-105/300,y:(329-251)/329},
		ghostlyReaper_3_left:{x:1-105/300,y:(329-251)/329},
		ghostlyReaper_4_left:{x:1-104/300,y:(329-251)/329},
		ghostlyReaper_5_left:{x:1-103/300,y:(329-250)/329},
		ghostlyReaper_6_left:{x:1-104/300,y:(329-249)/329},
		ghostlyReaper_7_left:{x:1-104/300,y:(329-247)/329},
		ghostlyReaper_8_left:{x:1-105/300,y:(329-245)/329},
		ghostlyReaper_9_left:{x:1-105/300,y:(329-244)/329},
		ghostlyReaper_10_left:{x:1-106/300,y:(329-244)/329},
		ghostlyReaper_11_left:{x:1-106/300,y:(329-245)/329},
		ghostlyReaper_12_left:{x:1-107/300,y:(329-245)/329},
		ghostlyReaper_13_left:{x:1-107/300,y:(329-246)/329},
		ghostlyReaper_14_left:{x:1-107/300,y:(329-247)/329},
		ghostlyReaper_15_left:{x:1-107/300,y:(329-249)/329},
		ghostlyReaper_16_left:{x:1-106/300,y:(329-250)/329},
		ghostlyReaper_17_left:{x:1-106/300,y:(329-251)/329},

		ghostlyReaper_1_attack_left:{x:1-106/300,y:(329-251)/329},
		ghostlyReaper_2_attack_left:{x:1-127/300,y:(329-238)/329},
		ghostlyReaper_3_attack_left:{x:1-142/300,y:(329-219)/329},
		ghostlyReaper_4_attack_left:{x:1-150/300,y:(329-195)/329},
		ghostlyReaper_5_attack_left:{x:1-153/300,y:(329-174)/329},
		ghostlyReaper_6_attack_left:{x:1-150/300,y:(329-152)/329},
		ghostlyReaper_7_attack_left:{x:1-140/300,y:(329-131)/329},
		ghostlyReaper_8_attack_left:{x:1-136/300,y:(329-128)/329},
		ghostlyReaper_9_attack_left:{x:1-131/300,y:(329-126)/329},
		ghostlyReaper_10_attack_left:{x:1-170/300,y:(329-162)/329},
		ghostlyReaper_11_attack_left:{x:1-188/300,y:(329-206)/329},
		ghostlyReaper_12_attack_left:{x:1-162/300,y:(329-242)/329},
		ghostlyReaper_13_attack_left:{x:1-128/300,y:(329-261)/329},
		ghostlyReaper_14_attack_left:{x:1-126/300,y:(329-260)/329},
		ghostlyReaper_15_attack_left:{x:1-123/300,y:(329-260)/329},
		ghostlyReaper_16_attack_left:{x:1-120/300,y:(329-259)/329},

	}
}

// Mapowanie zIndex na podstawie typu
const Z_INDEX_BY_TYPE = {
    [objectType.PLAYER]: 15,
    [objectType.PET]: 14,
    [objectType.BOSSHELPER]: 11,
    [objectType.EFFECT]: 12,
    [objectType.TILE]: 5,
    [objectType.BACKGROUND]: 5
};

// Funkcje inicjalizujące dla konkretnych TYPÓW
const TYPE_HANDLERS = {
    [objectType.BACKGROUND]: (object) => { object.collisionPriority = 255; },
    [objectType.TILE]: (object) => { object.collisionPriority = 200; },
    [objectType.EFFECT]: (object) => {
        object.addHandler(objectHandlerFunc_EFFECT);
        if (object.name.startsWith("armor_breaking_effect")) {
            object.originalHeight = object.height;
            object.originalWidth = object.width;
            object.width = 0;
            object.height = 0;
            object.addHandler(objectHandlerFunc_ARMOR_BREAKING_EFFECT);
        }
    },
    [objectType.PLAYER]: (object) => {
        object.canSleep = false;
        object.inHide = false;
        object.inHideTime = 0;
        object.addHandler(objectHandlerFunc_PLAYER);
        object.addOnScreenHandler(objectOnScreenHandlerFunc_PLAYER);
        object.addCollisionOnTrigger(collisionOnTrigger_PLAYER);
        object.addCollisionOnObtain(collisionOnObtain_PLAYER);
    },
    [objectType.HIDE]: (object) => object.addCollisionOnObtain(collisionOnObtain_HIDE),
    [objectType.TOMBSTONE]: (object) => {
        game.loadObjectLazySprites(object.name);
        object.addHandler(objectHandlerFunc_TOMBSTONE);
        object.addCollisionOnTrigger(collisionOnTrigger_TOMBSTONE);
        object.addCollisionOnObtain(collisionOnObtain_TOMBSTONE);
    },
    [objectType.TELEPORT]: (object) => object.addCollisionOnObtain(collisionOnObtain_TELEPORT),
    [objectType.PET]: (object) => {
        object.canSleep = false;
        object.addHandler(objectHandlerFunc_PET);
    }
};

// Pomocnicze funkcje handlerów (reusable)
const setupWater = (object) => object.addCollisionOnObtain(collisionOnObtain_WATER);
const setupIgnoreFood = (object) => object.addCollisionOnObtain(collisionOnObtain_IGNOREFOOD);
const setupSpiderWeb = (object) => object.addCollisionOnObtain(collisionOnObtain_SPIDERWEB);
const setupIgnoreFoodTrigger = (object) => object.addCollisionOnTrigger(collisionOnTrigger_IGNOREFOOD);
const setupSpaceBackground = (object) => object.addCollisionOnObtain(collisionOnObtain_SPACE);
const setupRotateBall = (object) => {
    object.addCollisionOnObtain(collision_SNOWBALL); // Uwaga: SNOWBALL/SHURIKEN/VOLLEY mają podobne, ale sprawdzić czy identyczne kolizje
    object.addCollisionOnTrigger(collision_SNOWBALL);
    object.rotateSpeed = 2;
    object.addHandler(objectHandlerFunc_ROTATEBALL);
};

// Mapowanie logiki dla konkretnych NAZW (name)
const NAME_HANDLERS = {
    'skull': (object) => {
        object.moveSpeed.y = 30;
        object.moveSpeed.x = 0;
        object.addHandler(objectHandlerFunc_SKULL);
    },
    'water': setupWater, 'water2': setupWater, 'water2_fill': setupWater, 'ocean': setupWater, 'arctic': setupWater,
    'ectoplasm_fire': (object) => object.addCollisionOnObtain(collisionOnObtain_ECTOPLASM),
    'waterDrop': (object) => object.addCollisionOnObtain(collisionOnObtain_WATERDROP),
    'roots': (object) => object.addCollisionOnObtain(collisionOnObtain_ROOTS),
    'bear_trap': (object) => {
        object.trapState = 0;
        object.addOnScreenHandler(objectOnScreenHandlerFunc_BEARTRAP);
        object.addCollisionOnObtain(collisionOnObtain_BEARTRAP);
    },
    'wall_spikes': (object) => object.addCollisionOnObtain(collisionOnObtain_WALLSPIKES),
    'swamp': (object) => object.addCollisionOnObtain(collisionOnObtain_SWAMP),
    'toxic_water': (object) => object.addCollisionOnObtain(collisionOnObtain_TOXICWATER),
    'volleyball': (object) => {
        object.addCollisionOnObtain(collision_VOLLEYBALL);
        object.addCollisionOnTrigger(collision_VOLLEYBALL);
        object.addHandler(objectHandlerFunc_ROTATEBALL);
    },
    'taxi': (object) => {
        if (object.position.x < 73000 && game.sprites["taxi_xmas"]) {
            object.animations = { none: { sprites: ["taxi_xmas"] } };
        }
    },
    'shuriken': (object) => {
        object.addCollisionOnObtain(collision_SHURIKEN);
        object.addCollisionOnTrigger(collision_SHURIKEN);
        object.rotateSpeed = 2;
        object.addHandler(objectHandlerFunc_ROTATEBALL);
    },
    'gem_moveable': (object) => {
        object.addCollisionOnObtain(collision_GEM_MOVEABLE);
        object.addCollisionOnTrigger(collision_GEM_MOVEABLE);
        object.rotateSpeed = 2;
        object.addHandler(objectHandlerFunc_ROTATEBALL);
    },
    'snowball': (object) => {
        object.addCollisionOnObtain(collision_SNOWBALL);
        object.addCollisionOnTrigger(collision_SNOWBALL);
        object.rotateSpeed = 2;
        object.addHandler(objectHandlerFunc_ROTATEBALL);
    },
    'spiderweb_throwable': (object) => {
        object.addCollisionOnObtain(collision_SPIDERWEB);
        object.addCollisionOnTrigger(collision_SPIDERWEB);
        object.rotateSpeed = 2;
        object.addHandler(objectHandlerFunc_ROTATEBALL);
    },
    'bomb': (object) => object.addHandler(objectHandlerFunc_ROTATEBALL),
    'spike_trap_saw': (object) => {
        object.rotateSpeed = 400;
        object.addHandler(objectHandlerFunc_ROTATE);
        object.addCollisionOnTrigger(collisionOnTrigger_SAW);
    },
    'lava': (object) => {
        object.addCollisionOnObtain(collisionOnObtain_LAVA);
        object.addOnScreenHandler(objectOnScreenHandlerFunc_LAVA, { interval: 1000 });
    },
    'lava_rising': (object) => { // To samo co lava
        object.addCollisionOnObtain(collisionOnObtain_LAVA);
        object.addOnScreenHandler(objectOnScreenHandlerFunc_LAVA, { interval: 1000 });
    },
    'lava_bubble': (object) => object.addHandler(objectHandlerFunc_EFFECT),
    'gem': (object) => object.addCollisionOnObtain(collisionOnObtain_GEM),
    'br_portal': (object) => object.addCollisionOnObtain(collisionOnObtain_BATTLEROYALEPORTAL),
    'potion_armor': (object) => {
        object.originalPosition = { x: object.position.x, y: object.position.y };
        object.addOnScreenHandler(objectOnScreenHandlerFunc_POTION);
        object.addCollisionOnObtain(collisionOnObtain_POTION);
    },
    'parchment_info': (object) => {
        object.originalPosition = { x: object.position.x, y: object.position.y };
        object.addCollisionOnObtain(collisionOnObtain_PARCHMENTINFO);
        object.addOnScreenHandler(objectOnScreenHandlerFunc_PARCHMENTINFO);
    },
    // Grupa ignore food
    'currant': setupIgnoreFood, 'ladybug': setupIgnoreFood, 'cherry': setupIgnoreFood,
    'strawberry': setupIgnoreFood, 'woodpecker': setupIgnoreFood, 'starFruit': setupIgnoreFood,
    'star': setupIgnoreFood, 'starfish': setupIgnoreFood, 'beehive': setupIgnoreFood,
    'egg': setupIgnoreFood, 'halloweenGhost': setupIgnoreFood, 'halloweenPumpkin': setupIgnoreFood,
    'easterEgg': (object) => 
		{
			object.originalPosition = { x: object.position.x, y: object.position.y };
			object.addOnScreenHandler(objectOnScreenHandlerFunc_EASTEREGG);
			object.addCollisionOnObtain(collisionOnObtain_IGNOREFOOD);
		},
    // Grupa spiderweb
    'spiderweb_1': setupSpiderWeb, 'spiderweb_2': setupSpiderWeb, 'spiderweb_3': setupSpiderWeb,
    'spiderweb_temporary': setupSpiderWeb,
    
    // Grupa Space
    'background_lightblue_to_purple': (object) => object.addCollisionOnObtain(collisionOnObtain_SPACEBOTTOM),
    
    // Grupa Trigger Ignore Food
    'crocodile': setupIgnoreFoodTrigger, 'giantRat': setupIgnoreFoodTrigger, 
    'mammoth': setupIgnoreFoodTrigger, 'tyrannosaurus': setupIgnoreFoodTrigger, 
	'tyrannosaurus_easter': setupIgnoreFoodTrigger, 
    'blackWidow': setupIgnoreFoodTrigger, 'turtle': setupIgnoreFoodTrigger,

    'fireball': (object) => {
        object.addCollisionOnTrigger(collisionOnObtainTrigger_FIREBALL);
        object.addCollisionOnObtain(collisionOnObtainTrigger_FIREBALL);
    },
    'plasmaball': (object) => {
        object.addCollisionOnTrigger(collisionOnObtainTrigger_FIREBALL);
        object.addCollisionOnObtain(collisionOnObtainTrigger_FIREBALL);
    },
    'boss1Bat': (object) => {
        object.addCollisionOnTrigger(collision_BOSS1BAT);
        object.addCollisionOnObtain(collision_BOSS1BAT);
    },
    'kingJustice': (object) => {
        object.sentence = 1;
        object.lastShowLink = 0;
        object.addHandler(objectHandlerFunc_KINGJUSTICE, { interval: 5000 });
        object.addCollisionOnObtain(collisionOnObtain_KINGJUSTICE);
    },
    'executioner': (object) => {
        object.sentence = 1;
        object.addHandler(objectHandlerFunc_EXECUTIONER, { interval: 12000 });
        object.addCollisionOnObtain(collisionOnObtain_EXECUTIONER);
    }
};

const BACKGROUND_SNOW_NAMES = new Set([
    "background_lightblue", "background_lightblue_to_purple", 
    "background_graveyard_1", "background_graveyard_2", 
    "background_graveyard_3", "background_graveyard_top"
]);




game.onCreateObject = function (object) {
    if (Number.isFinite(object.fadeOutDuration) && object.fadeOutDuration>0)
        object.staticCanvas=false;
    
    // 1. Obsługa zIndex
    if (object.zIndex == 0) {
        if (Z_INDEX_BY_TYPE[object.type] !== undefined) {
            object.zIndex = Z_INDEX_BY_TYPE[object.type];
        } else if (object.type == objectType.FOOD) {
            object.zIndex = object.moveable ? 11 : 10;
        }
    }

    // 2. Obsługa logiki opartej na TYPIE (lookup table)
    const typeHandler = TYPE_HANDLERS[object.type];
    if (typeHandler) typeHandler(object);

    // 3. Obsługa logiki opartej na NAZWIE (lookup table - szybki dostęp)
    const nameHandler = NAME_HANDLERS[object.name];
    if (nameHandler) nameHandler(object);

    // 4. Obsługa właściwości ogólnych
    if (object.stickTo)
        object.addHandler(objectHandlerFunc_STICK);

    if (object.safeZone)
        object.addCollisionOnObtain(collisionOnObtain_SAFEZONE);
    
    if (object.arenaZone)
        object.addCollisionOnObtain(collisionOnObtain_ARENAZONE);

    if (object.battleRoyaleZone)
        object.addCollisionOnObtain(collisionOnObtain_BATTLEROYALEZONE);

    if (object.needBeSynced)
        object.addHandler(objectHandlerFunc_NEEDBESYNCED);

    // 5. Ruch i fizyka (dla obiektów ruchomych i gracza)
    // Wyjątek: PLAYER jest obsługiwany, ale EFFECT nie
    if ((object.moveable && object.type != objectType.EFFECT) || object.type == objectType.PLAYER) {
        object.lastInFluidTime = 0;
        object.moveDirection = 0;
        object.addHandler(objectHandlerFunc_MOVEABLE);
        if (object.lockSpeedX != null) {
            object.addHandler(objectHandlerFunc_LOCKMOVESPEEDX);
        }
    }

    // 6. Przypadki specjalne "Prefixowe" (indexOf == 0)
    // Te trudniej wrzucić do mapy, więc zostają jako ify, ale jest ich mało.
    if (object.name.startsWith("background_space_"))
        object.addCollisionOnObtain(collisionOnObtain_SPACE);
    
    if (object.name.startsWith("alienFruit"))
        object.addCollisionOnObtain(collisionOnObtain_IGNOREFOOD);

    // Dodatkowy handler dla halloweenGhost (oprócz ignoreFood z mapy)
    if (object.name == "halloweenGhost")
        object.addHandler(objectHandlerFunc_HALLOWEENGHOST);


    // 7. Logika Świąteczna (Christmas Time)
    if (window.christmasTime) {
        handleChristmasLogic(object);
    }
};

// Wydzielona logika świąteczna dla czytelności
function handleChristmasLogic(object) {
    // Śnieg na tłach
    if (BACKGROUND_SNOW_NAMES.has(object.name)) {
        if (object.position.y >= 2304 && object.position.x < 73664 && object.position.x > 7800) {
            var newObject = game.newObject(game.objectsDef["snow_animation"]);
            newObject.id = null;
            newObject.position.x = object.position.x;
            newObject.position.y = object.position.y;

            // Logika przezroczystości
            if (object.position.x > 72664 || object.position.x < 8800) newObject.opacity /= 3;
            else if (object.position.x > 71664 || object.position.x < 9800) newObject.opacity /= 2;
            else if (object.position.x > 70664 || object.position.x < 10800) newObject.opacity /= 1.5;
            else if (object.position.x > 69664 || object.position.x < 11800) newObject.opacity /= 1.2;

            if (object.position.y > 3000) newObject.opacity /= 1.5;

            // Dodanie obiektu
            const key = newObject.position.x + "_" + newObject.position.y;
            if (!snowAnimationSpots[key]) {
                newObject.addHandler(objectHandlerFunc_SNOWANIMATION);
                game.addObject(newObject);
                snowAnimationSpots[key] = true;
            }
        }
    }

    // Zamiana trawy na śnieg
    if (object.name.startsWith("dirt_grass") && object.position.y < 4300) {
        Object.assign(object, game.objectsDef["dirt_snow"]);
        object.animation = randomInteger(1, 2).toString();
    }
}














var snowAnimationSpots=[];

//-1 avoid, 0 neutral, 1 eats
function checkFoodChain(object1,object2)
{
	if (object1.id==object2.id) return {check:0};

	//if(!(((object1.type==objectType.PLAYER) || object1.type==objectType.FOOD) && ((object2.type==objectType.PLAYER) || object2.type==objectType.FOOD))) return {check:0};

	if (object1.eatsSouls && (object2.type==objectType.PLAYER || object2.hasSoul || object2.type==objectType.BOSS || object2.type==objectType.BOSSHELPER) && object2.immortal!==true)
	return {check:1,dmg:0,exp:0};

	if (object2.eatsSouls && (object1.type==objectType.PLAYER || object1.hasSoul || object1.type==objectType.BOSS || object1.type==objectType.BOSSHELPER) && object1.immortal!==true)
	return {check:-1,dmg:0,exp:0};


	
	if (foodChain[object1.name] && foodChain[object1.name].eats[object2.name])
	{
			var dmg=foodChain[object1.name].eats[object2.name].dmg;
			var exp=foodChain[object1.name].eats[object2.name].exp || 0;
	
			return {check:1,dmg:dmg,exp:exp};
	}
	
	if (foodChain[object2.name] && foodChain[object2.name].eats[object1.name])
	{
			var dmg=foodChain[object2.name].eats[object1.name].dmg;
			var exp=foodChain[object2.name].eats[object1.name].exp || 0;

			return {check:-1,dmg:dmg,exp:exp};
	}
	
	return {check:0};
}

function doAttack(object,direction)
{
	if (direction==1)
	var animation='attacking_right';
	else
	var animation='attacking_left';
	if (object.animations[animation])
	{
	object.animationFrame=0;
	object.animation = animation;
	}
}


function getExpFromTable(name)
{
	var fromExp=0;
	var toExp=0;
	for (var i=0;i<Object.keys(expTable).length;i++)
	{
		var expName=Object.keys(expTable)[i];
		toExp+=expTable[expName].exp;
		if (expName==name) break;
		
		if (expName=="alienBat" && name=="overfedAlienBat") break;
		fromExp=toExp;
	}
	return {fromExp:fromExp,toExp:toExp}
}

function checkDistance(posx1, posy1, posx2, posy2)
{
	var a = posx1 - posx2;
	var b = posy1 - posy2;
	var c = Math.sqrt( a*a + b*b );
	return c;
}

function drawHints()
{

	if (user.level==0 && myExperience<1600 && canEatArr.length>0 && !imDead)
	{
	var myPosition=game.me.getAllPositions();
	var closest=null;
	var distance=600;
	for (var i=0;i<canEatArr.length;i++)
		{
			var target=canEatArr[i];
			if (target.deleted || target.type!=objectType.FOOD) continue;
			var foodPosition=target.getAllPositions();
			var d=checkDistance(myPosition.center.x, myPosition.center.y, foodPosition.center.x, foodPosition.center.y);
			if (d<600 && d<distance)
				{
					distance=d;
					closest=canEatArr[i];
				}
		}
	
		if (closest!=null && distance<600 && distance>90)
		{
			
			
			var fractionOfTotal = 40 / distance;
			var foodPosition=closest.getAllPositions();
			var xDist = myPosition.center.x - foodPosition.center.x;
			var yDist = myPosition.center.y - foodPosition.center.y;

			var weight=10;
			if (myExperience>1300)
			weight=parseInt(((1600-myExperience)/400*weight));
			if (weight<1) weight=1;

			var color="red";
			game.drawArrow(myPosition.center.x - xDist * fractionOfTotal, myPosition.center.y - yDist * fractionOfTotal, foodPosition.center.x + xDist * fractionOfTotal, foodPosition.center.y + yDist * fractionOfTotal, weight, color);
		}
	}
}

function drawSpawnTimer(mode)
{
	if (spawnTimerData)
	{
		for (var i=0;i<spawnTimerData.length;i++)
			{
				let spawn=spawnTimerData[i];
				let positionX=spawn.a;
				let positionY=spawn.b;
				let spawning=spawn.c;
				let timeleft=spawn.d;

				if (game.objectsDef[spawning])
				{
				let object=game.objectsDef[spawning];

				if (object.type==objectType.BOSS && object.name=="boss1" && showBossTimer==false) continue;
				
				let zIndex=object.zIndex || 0;

				if (mode==1 && zIndex>15) continue;
				if (mode==2 && zIndex<=15) continue;
				

				let sprite=game.sprites[game.objectsDef[object.name].animations[object.animation].sprites[0]];
				game.drawSpriteFast(sprite,positionX,positionY,object.height,object.width,0.25);

				var minutes = "0" + (Math.floor(timeleft / 60) % 60);
				var seconds = "0" + (timeleft % 60);
				var formattedTime =  minutes.substr(-2) + ':' + seconds.substr(-2);

				let style={};
				style.fillStyle = "#f24500";
				style.font = 15*game.fontScale*game.zoom+"pt monospace";
				style.textAlign="center";

				game.drawText(formattedTime,positionX+object.width/2,positionY+object.height/2,style);
				}
				
			}

	}
}


function drawTextEffects()
{
	for (var i=0;i<textEffects.length;i++)
	{
	var effect=textEffects[i];

	if (effect.effectType=="experience")
	{
		var elapsed=game.time-effect.startTime;
		var endTime=effect.duration || 1600;
		var progress=elapsed/endTime;

		if (progress>=1)
		{
			textEffects.splice(i, 1);
			i--;
			continue;
		}

		var easedRise=1-Math.pow(1-progress,2.25);
		var fadeOut=Math.pow(1-progress,0.82);
		var introPop=1+Math.sin(min(1,progress*1.35)*Math.PI)*(effect.pulseStrength || 0.12);
		var settleScale=1-progress*0.05;
		var pulse=introPop*settleScale;
		var fontSize=(effect.baseFontSize || effect.fontSize || 14)*pulse;
		var sway=(effect.sway || 0)*Math.sin(progress*(effect.driftFrequency || 5.2)+(effect.phase || 0))*(1-progress*0.72);
		var floatDistance=(effect.floatDistance || 48)*easedRise;
		var startOffsetX=effect.startOffsetX || 0;
		var startOffsetY=effect.startOffsetY || 0;
		var velocityX=(effect.velocityX || 0)*progress*(1-progress*0.18);
		var velocityY=(effect.velocityY || 0)*easedRise;
		var driftX=(effect.driftX || 0)*Math.sin(progress*Math.PI*1.35+(effect.phase || 0))*(1-progress*0.35);
		var drawX=(effect.originX || effect.posX)+startOffsetX+velocityX+driftX+sway;
		var drawY=(effect.originY || effect.posY)+startOffsetY+floatDistance+velocityY+(progress*4);
		var glowBlur=(fontSize*0.38)+5;
		var strokeWidth=max(2.5,fontSize*0.18)*game.fontScale*game.zoom;

		var coreStyle={
			font:"900 "+fontSize*game.fontScale*game.zoom+"pt monospace",
			fillStyle:effect.color || "#ffffff",
			textAlign:"center",
			strokeStyle:effect.outlineColor || "#000000",
			lineWidth:strokeWidth,
			lineJoin:"round",
			miterLimit:2,
			shadowColor:effect.shadowColor || "rgba(120,255,141,0.35)",
			shadowBlur:glowBlur,
			shadowOffsetX:0,
			shadowOffsetY:0
		};

		game.drawText(effect.text,drawX,drawY,coreStyle,fadeOut);

		continue;
	}

	var style={};
	
	if (effect.bold)
		style.font = "800 "+effect.fontSize*game.fontScale*game.zoom+"pt monospace";
	else
		style.font = effect.fontSize*game.fontScale*game.zoom+"pt monospace";

	style.fillStyle = effect.color;
	style.textAlign="center"; 
	
	game.drawText(effect.text,effect.posX,effect.posY,style);

	var endTime;
	if (effect.static!==true)
	{
		effect.posY+=1*60/game.gameLoopOPS;
		endTime=1400;
	}
	else
		endTime=4000;

	if (game.time-effect.startTime>endTime)
	{
		textEffects.splice(i, 1);
		i--;
	}
	}
}

///////////////


function animateObject(object)
{
	setAnimations(object);

	if (game.me.inSafeZone || object.inSafeZone) 
		object.outline = null;	
	else
	{
		var chain = checkFoodChain(game.me, object);

		if (chain.check == 1) {
			{
			object.outline = "#00cc44"; //green
			canEatArr.push(object);
			}
			
			if (checkFoodChain(object,game.me).check==1)
			{
				object.outline = "orange"; //eat each other
				canEatArr.push(object);
			}

			object.outlineWeight = 3;
		} else if (chain.check == -1) {
			object.outline = "red";
			object.outlineWeight = 2;
		} else
			object.outline = null;	
	}
}

function objectHandlerFunc_PLAYER(object)
{
	var grabbedActive=false;
	if (object.grabbed && object.grabbedById!=null)
	{
		var grabbedBy=game.gameObjects[object.grabbedById];
		if (grabbedBy && !grabbedBy.deleted)
		{
			grabbedActive=true;
			var grabTargetX=grabbedBy.position.x+(object.grabOffsetX || 0);
			var grabTargetY=grabbedBy.position.y+(object.grabOffsetY || 0);
			var grabFollowDeltaTime=Math.max(game.deltaTime,1/(game.gameLoopOPS || 52));
			var grabMaxFollowSpeed=700;
			object.moveSpeed.x=Math.max(-grabMaxFollowSpeed,Math.min(grabMaxFollowSpeed,(grabTargetX-object.position.x)/grabFollowDeltaTime));
			object.moveSpeed.y=Math.max(-grabMaxFollowSpeed,Math.min(grabMaxFollowSpeed,(grabTargetY-object.position.y)/grabFollowDeltaTime));
			object.gravityOn=false;
			object.loadColliders=true;
		}
	}

	if (object.inBattleRoyaleZone && object!=game.me)
	{
		object.petID=null;
	}

	petFunc(object);

	if (!grabbedActive && object.inHide==false)
	{
	object.moveSpeed.x+=300*game.deltaTime*object.flySide;
	if (object.moveSpeed.x>500) object.moveSpeed.x-=abs(350*game.deltaTime*object.flySide);
	else if (object.moveSpeed.x<-500) object.moveSpeed.x+=abs(350*game.deltaTime*object.flySide);
	if (object.moveSpeed.y>500) object.moveSpeed.y=500;
	}

	if (!grabbedActive && object.flySide==0)
	{
		var speedDecrease=abs(object.moveSpeed.x)*0.7*game.deltaTime;
		if (object.moveSpeed.x<0)
			object.moveSpeed.x+=speedDecrease;
		else
			object.moveSpeed.x-=speedDecrease;
		
	}
	
	
			
	if (object.inHide)
	{
		if (game.time-object.inHideTime>500)
		{
		object.visible=false;
		if (object.pet) object.pet.visible=false;
		}

		object.moveSpeed.x=0;
		object.moveSpeed.y=0;
		
	}
	else
	{
		object.visible=true;
		if (object.pet) object.pet.visible=true;
	}
	

	if (object.invisibleTime>game.time)
	{
		var chain = checkFoodChain(game.me, object);

		if (chain.check == 1 || chain.check == -1)
			object.opacity=0;
		else
			object.opacity=0.2;

		
	}
	else
		object.opacity=1;



	object.interpolateSpeed=0.015;
	if (object.grabbed) object.interpolateSpeed=0.1;
	if (object.inHide==true)
	{
	if (object.interpolateTo.x != null || object.interpolateTo.y != null)
	{
		object.interpolateSpeed=0.05;
		game.interpolatePosition(object);
	}
		return false;
	}

	
	if (object.armorBreakingEffect == true)
		{
			object.armorBreakingEffect = false;
			var newObject = game.newObject(game.objectsDef["armor_breaking_effect"]);
			newObject.id = null;
			newObject.stickTo=object;
			newObject.position.x = object.position.x;
			newObject.position.y = object.position.y;
			newObject.width = Math.max(object.width,object.height);
			newObject.height = Math.max(object.width,object.height);
			game.addObject(newObject).objectHandlers;
		}

		

}

function objectOnScreenHandlerFunc_PLAYER(object)
{
if (object.inBattleRoyaleZone && object!=game.me)
	{
		object.skin=0;
	}
}

function petFunc(object)
{
	if (object.petID)
	{
		if (object.pet==null || object.pet.deleted)
		{
			if (game.objectsDef["pet_"+object.petID])
			{	
				var pet=game.newObject(game.objectsDef["pet_"+object.petID]);
				var ownerPos=object.getAllPositions();
				if (object.inHide)
				var spot=ownerPos.center;
				else
				{
				var offsetX=object.petOffset.x*-object.direction;
				var spot={x:ownerPos.center.x+offsetX-pet.width/2, y:object.position.y+object.petOffset.y-pet.height/2};
				}

				pet.id=0;
				pet.petID=object.petID;
				pet.position.x=spot.x;
				pet.position.y=spot.y;
				pet.owner=object;
				pet.moveSpeed.x=object.moveSpeed.x;
				pet.moveSpeed.y=object.moveSpeed.y;
				object.pet=game.addObject(pet);
			}
		}
	}
}

function objectHandlerFunc_SNOWANIMATION(object)
{
	if (lowPerformanceMode) 
		{
			game.deleteObject(object);
			return false;
		}
}

function objectHandlerFunc_ROTATEBALL(object)
{
	let rotateSpeed = object.rotateSpeed || 1;
	object.rotation += object.moveSpeed.x * game.deltaTime * rotateSpeed;
	if (object.rotation > 360) object.rotation -= 360;
	if (object.rotation < 0) object.rotation += 360;
}

function objectHandlerFunc_ROTATE(object)
{
	let rotateSpeed = object.rotateSpeed || 200;
	object.rotation += rotateSpeed * game.deltaTime;
	if (object.rotation > 360) object.rotation -= 360;
	if (object.rotation < 0) object.rotation += 360;
}

function createObjectFadeOut(object)
{
	var duration=object.fadeOutDuration;
	if (object.deleted || !object.visible || object.opacity<=0 || !Number.isFinite(duration) || duration<=0)
		return;
	var animation=object.animations && object.animations[object.animation];
	if (!animation || !animation.sprites || animation.sprites.length==0) return;
	var spriteName=animation.sprites[object.animationFrame%animation.sprites.length];
	var definition=game.objectsDef[object.name];
	if (object.skin && definition && definition.skinsLoaded && definition.skinsLoaded[object.skin])
		spriteName+="_"+object.skin;
	if ((!game.sprites[spriteName] || !game.sprites[spriteName].loaded) && object.animations.none)
		spriteName=object.animations.none.sprites[object.animationFrame%object.animations.none.sprites.length];

	var effect=game.newObject({
		name:"object_fadeout", type:objectType.MISC, id:null,
		animations:{none:{sprites:[spriteName]}}, animation:"none",
		position:{x:object.position.x,y:object.position.y},
		width:object.width, height:object.height,
		zIndex:object.zIndex, rotation:object.rotation,
		opacity:object.opacity, fadeOutOpacity:object.opacity, fadeOutTime:duration,
		outline:object.outline, outlineWeight:object.outlineWeight, border:object.border,
		fillColor:object.fillColor, fillColorOpacity:object.fillColorOpacity, fixedDraw:object.fixedDraw,
		isCollider:false, staticCanvas:false, moveable:false, gravityOn:false
	});
	effect.addHandler(objectHandlerFunc_FADEOUT);
	game.addObject(effect);
}

function objectHandlerFunc_FADEOUT(object)
{
	var remaining=Math.max(0,1-(game.time-object.createTime)/object.fadeOutTime);
	object.opacity=object.fadeOutOpacity*remaining;
	if (remaining==0)
		game.deleteObject(object);
}

function objectHandlerFunc_SKULL(object)
{
	//if (game.time - object.createdTime > 1000)
		var opacity=(3500-(game.time - object.createTime))/1500;
	
	if (opacity<1)
	object.opacity=opacity;
	
	if (game.time - object.createTime > 3500)
		game.deleteObject(object);		
}

function objectHandlerFunc_EFFECT(object)
{
	if (!game.isVisible(game.me, object, game.canvas.width / 2, game.canvas.height / 2))
	{
	game.deleteObject(object);	
	return;
	}	

	if (object.name!='skull')
	{
		if (object.animationFrame%object.animations[object.animation].sprites.length==object.animations[object.animation].sprites.length-1 && object.animationFrame!=0)
		game.deleteObject(object);
		return;
	}
			
}

function objectHandlerFunc_ARMOR_BREAKING_EFFECT(object) {
	const fadeInDuration = 150; // Duration for fade-in
	const waitDuration = 300; // Duration to wait before fade-out
	const fadeOutDuration = 600; // Duration for fade-out
	const totalDuration = fadeInDuration + waitDuration + fadeOutDuration;
	const maxOpacity = 0.7; // Maximum opacity

	const elapsedTime = game.time - object.createTime;

	if (elapsedTime > totalDuration) {
		game.deleteObject(object);
	} else if (elapsedTime < fadeInDuration) {
		const progress = elapsedTime / fadeInDuration; // Progress for fade-in
		object.opacity = progress * maxOpacity; // Fade in with max opacity
		object.width = object.originalWidth * progress; // Scale width
		object.height = object.originalHeight * progress; // Scale height
	} else if (elapsedTime < fadeInDuration + waitDuration) {
		object.opacity = maxOpacity; // Wait with max opacity
		object.width = object.originalWidth; // Full width
		object.height = object.originalHeight; // Full height
	} else {
		const progress = (elapsedTime - fadeInDuration - waitDuration) / fadeOutDuration; // Progress for fade-out
		object.opacity = maxOpacity * (1 - progress); // Fade out with max opacity
	}
}

function objectHandlerFunc_TOMBSTONE(object)
{

	var opacity=(10000-(game.time - object.createTime))/1500;
	if (opacity<1)
	object.opacity=opacity;
	
	if (game.time - object.createTime > 10000)
	{
		game.deleteObject(object);	
		return;
	}

	if (object.animation=="start")
	if (object.animationFrame%object.animations[object.animation].sprites.length==object.animations[object.animation].sprites.length-1 && object.animationFrame!=0 && object.animations["end"])
	{
		object.animationFrame=0;
		object.animation="end";
	}
}

function objectOnScreenHandlerFunc_BEARTRAP(object)
{

	if (!game.isVisible(game.me, object, game.canvas.width / 2, game.canvas.height / 2))
	{
		if (object.animation=="open")
			object.trapState=0;
		else if (object.animation=="closed")
			object.trapState=2;
	}
	else if (object.trapState==0)
	{
		if (object.animation=="closed")
		{
		object.trapState=1;
		object.animation="closing";
		}
		else
		object.animation="open";
	}
	else if (object.trapState==1)
	{
		
		if (object.animationFrame%object.animations[object.animation].sprites.length==object.animations[object.animation].sprites.length-1 && object.animationFrame!=0)
		{
			object.trapState=2;
			object.animation="closed";
		}
		else
		object.animation="closing";
	}
	else if (object.trapState==2)
	{
		if (object.animation=="open")
		{
		object.trapState=3;
		object.animation="opening";
		}
		else
		object.animation="closed";
	}
	else if (object.trapState==3)
	{
		if (object.animationFrame%object.animations[object.animation].sprites.length==object.animations[object.animation].sprites.length-1 && object.animationFrame!=0)
		{
			object.trapState=0;
			object.animation="open";
		}
		else
			object.animation="opening";
	}



}

function objectHandlerFunc_KINGJUSTICE(object)
{

	if (mySkins["ghostlyReaper"] && mySkins["ghostlyReaper"][17]) return;

	if (getDistance(object.position.x+object.width, object.position.y, game.me.position.x, game.me.position.y)>600) return;
	
	if (object.sentence>0)
	{
	object.chat=getTranslation("kingjustice_"+object.sentence,["King Justice"]).capitalize();
	object.chatStartTime=game.time;

	}

	object.sentence++;
	if (object.sentence>3) object.sentence=-2;
}

function collisionOnObtain_KINGJUSTICE(object1, object2)
{
	if (object2!=game.me) return false;	
	if (game.time-object1.lastShowLink>10000)
	{
		if (mySkins["ghostlyReaper"] && mySkins["ghostlyReaper"][17])
			object1.chat=getTranslation("kingjustice_collected").capitalize();
		else
			object1.chat=getTranslation("kingjustice_visit").capitalize();
			object1.chatStartTime=game.time;
			object1.sentence=-2;
			object1.lastShowLink=game.time;
	}

	return false;
}


function objectHandlerFunc_EXECUTIONER(object)
{

	if (getDistance(object.position.x+object.width, object.position.y, game.me.position.x, game.me.position.y)>600) return;
	

	// Keep track of the last 10 sentences to avoid repeats
	if (!object.lastSentences) object.lastSentences = [];
	let randInt;
	let tries = 0;
	do {
		randInt = Math.floor(Math.random() * 20) + 1;
		tries++;
	} while (object.lastSentences.includes(randInt) && tries < 50);

	object.lastSentences.push(randInt);
	if (object.lastSentences.length > 10) object.lastSentences.shift();

	object.chat=getTranslation("executioner_"+randInt).capitalize();
	object.chatStartTime=game.time;
}

function collisionOnObtain_EXECUTIONER(object1, object2)
{



	return false;
}

var askGiftBoxTime=0;

function collisionOnObtain_GIFTBOX(object1, object2)
{
if (!joinedGame || imDead) return false;
if (object2!=game.me) return false;

if (user.level<3) {textMsg(lang["gift_box_min_level"],"orange",1000); return false;}

if (askGiftBoxTime+10000>Date.now()) return false;

gameServer.emit('game:giftBox');


askGiftBoxTime=Date.now();

return false;
}

function objectHandlerFunc_HALLOWEENGHOST(object)
{
	if (game.me.getAllPositions().center.x>object.getAllPositions().center.x)
		object.animation="idle_right";
	else
		object.animation="idle_left";

		var a = game.me.getAllPositions().center.x - object.getAllPositions().center.x;
		var b = game.me.getAllPositions().center.y - object.getAllPositions().center.y;
		
		var dist = Math.sqrt( a*a + b*b );
		if (dist<500)
		{
			object.opacity=abs(501-dist)/500;
		}
		else
		object.opacity=0;
}

function objectHandlerFunc_STICK(object)
{
	if (object.stickTo && !object.stickTo.deleted)
	{
	object.position.x=object.stickTo.getAllPositions().center.x - object.width/2;
	object.position.y=object.stickTo.getAllPositions().center.y - object.height/2;
	}
}

function objectHandlerFunc_PET(pet)
{
	var owner=pet.owner;

	if (owner.deleted || owner.petID!=pet.petID)
	{
		if (owner.killed || (owner.petID!=pet.petID && pet.createTime+100<game.time))
			{

			var newObject = game.newObject(game.objectsDef["dust"]);
			newObject.width=pet.width;
			newObject.height=pet.width;
			newObject.animation = "standard";
			newObject.id = null;
			newObject.position.x = pet.position.x+pet.width/2 - newObject.width/2;
			newObject.position.y = pet.position.y+pet.height/2 - newObject.height/2;
			game.addObject(newObject);
			}

		game.deleteObject(pet);
		return false;
	}

	pet.interpolateSpeed=0.12;
	pet.moveSpeed.x=0;
	pet.moveSpeed.y=0;

	if (pet.victim)
	{

		var victim=pet.victim;
		var victimPos=victim.getAllPositions();
		pet.interpolateTo.x=victimPos.center.x;
		pet.interpolateTo.y=victimPos.center.y;

		if (victimPos.center.x>pet.position.x+pet.width/2)
			pet.animation="flapping_right";
		else
			pet.animation="flapping_left";

		if (game.time-pet.attackTime>1050 || victim.deleted)
				pet.victim=undefined;
	}
	else
	{
	var ownerPos=owner.getAllPositions();
	if (owner.inHide)
	{
	var spot=ownerPos.center;
	}
	else
	{

	var offsetX=owner.petOffset.x*-owner.direction;

	var spot={x:ownerPos.center.x+offsetX-pet.width/2, y:owner.position.y+owner.petOffset.y-pet.height/2};
	}
	
	if (!game.isVisible(owner, pet, game.canvas.width / 2, game.canvas.height / 2))
	{
		pet.position.x=spot.x;
		pet.position.y=spot.y;

	}
	
		
	pet.interpolateTo=spot;

	if (ownerPos.center.x>pet.position.x+pet.width/2)
	{
		
		let animation="flapping_right";

		if (pet.emote && pet.name=="pet_22")
		{
			if (pet.animationFrame%pet.animations[pet.animation].sprites.length == 0 || pet.animation=="blink_right" || pet.animation=="blink_left")
				animation="blink_right";
		}

		pet.animation=animation;
	}
	else
	{
		let animation="flapping_left";
		animation="flapping_left";
		if (pet.emote && pet.name=="pet_22")
			if (pet.animationFrame%pet.animations[pet.animation].sprites.length == 0 || pet.animation=="blink_right" || pet.animation=="blink_left")
				animation="blink_left";

		pet.animation=animation;
	}

	}

		
}

function objectHandlerFunc_NEEDBESYNCED(object)
{
	if (object.syncTick<syncTick) 
	{
		//console.log("Object not synced, deleting");
		//console.log(object.syncTick+"<"+syncTick);
		game.deleteObject(object);
		return false;
	}
}

function objectHandlerFunc_MOVEABLE(object)
{
	if (object.syncTick<syncTick && object.type!=objectType.PET) 
	{
		game.deleteObject(object);
		return false;
	}
	if (object.ignoreMovementReduction!=true)
	{
		if (object.inWater)
		{
			if (object.name=="duck" || object.name=="pelican"  || object.name=="seagull")
				{
					object.moveSpeed.y-=object.moveSpeed.y*5*game.deltaTime;
					object.moveSpeed.x-=object.moveSpeed.x*0.5*game.deltaTime;

				}
				else
				{
					object.moveSpeed.y-=object.moveSpeed.y*10*game.deltaTime;
					object.moveSpeed.x-=object.moveSpeed.x*2*game.deltaTime;
				}
		}else if (object.inSwamp)
		{
			if (object.name=="swampMonster")
				{
					object.moveSpeed.y-=object.moveSpeed.y*10*game.deltaTime;
					object.moveSpeed.x-=object.moveSpeed.x*2*game.deltaTime;	
				}
			else
				{
					object.moveSpeed.y-=object.moveSpeed.y*25*game.deltaTime;
					object.moveSpeed.x-=object.moveSpeed.x*10*game.deltaTime;
				}
		}else if (object.inLava)
		{
			if (object.lavaResistance===true)
				{
					object.moveSpeed.y-=object.moveSpeed.y*15*game.deltaTime;
					object.moveSpeed.x-=object.moveSpeed.x*3*game.deltaTime;	
				}
				else
				{
				object.moveSpeed.y-=object.moveSpeed.y*25*game.deltaTime;
				object.moveSpeed.x-=object.moveSpeed.x*15*game.deltaTime;
				}
		}else if (object.inToxic)
		{
				object.moveSpeed.y-=object.moveSpeed.y*10*game.deltaTime;
				object.moveSpeed.x-=object.moveSpeed.x*2*game.deltaTime;
		}
	}

if (object.inSpace && object.spaceResistance!==true && object.gravityOn && abs(object.moveSpeed.y)>1)
{
object.moveSpeed.y += game.gravity*0.7 * object.inSpaceScale/100 * game.deltaTime;
}
	
	//reset
	object.inWater=false;
	object.inToxic=false;
	object.inSwamp=false;
	object.inLava=false;
	object.inSpace=false;
	object.inEctoplasm=false;
	object.inSafeZone=false;
	object.inArenaZone=false;
	object.inBattleRoyaleZone=false;

	if (object.ignoreTiles>0)
		object.ignoreTiles-=1;
}

function collisionOnObtain_ROOTS(object1, object2, where)
{
	if (object2.type!=objectType.PLAYER)
		return false;
	
	object2.ignoreTiles=2;

	object2.moveSpeed.x=0;
	object2.moveSpeed.y=150;
	
	return false;
}

function collisionOnObtain_BEARTRAP(object1, object2, where)
{
	return false;
}

function collisionOnObtain_WALLSPIKES(object1, object2, where)
{
	return false;
}

function collisionOnObtain_WATER(object1, object2, where)
{	if (object2.moveable && game.time - object2.lastInFluidTime > 500)
	{
		var scale=Math.max(abs(object2.moveSpeed.x),abs(object2.moveSpeed.y))/800;
		if (scale>1) scale=1;
		if (scale>0.4)
		{
			scale*=2;
			var newObject = game.newObject(game.objectsDef["water_splash"]);
			newObject.id = null;
			newObject.height=newObject.height * ((object2.width * (1-(object2.colliderRectangleOffset.left + object2.colliderRectangleOffset.right))) / newObject.width) * scale;
			newObject.width=object2.width * (1-(object2.colliderRectangleOffset.left + object2.colliderRectangleOffset.right)) * scale;
			
			newObject.position.x = object2.position.x + object2.width/2 - newObject.width/2;
			newObject.position.y = object1.position.y + object1.height * (1-object1.colliderRectangleOffset.top);
			game.addObject(newObject);
		}
	}

	object2.lastInFluidTime=game.time;
	object2.inWater=true;
	return false;
}

function collisionOnObtain_TOXICWATER(object1, object2, where)
{
	if (object2.moveable && game.time - object2.lastInFluidTime > 500)
	{
		var scale=Math.max(abs(object2.moveSpeed.x),abs(object2.moveSpeed.y))/800;
		if (scale>1) scale=1;
		if (scale>0.2)
		{
			var newObject = game.newObject(game.objectsDef["bubble_splash"]);
			newObject.id = null;
			newObject.height=newObject.height * ((object2.width * (1-(object1.colliderRectangleOffset.left + object1.colliderRectangleOffset.right))) / newObject.width) * scale;
			newObject.width=object2.width * (1-(object1.colliderRectangleOffset.left + object1.colliderRectangleOffset.right)) * scale;
			
			newObject.position.x = object2.position.x + object2.width/2 - newObject.width/2;
			newObject.position.y = object1.position.y + object1.height * (1-object1.colliderRectangleOffset.top);
			game.addObject(newObject);
		}

	}

	object2.lastInFluidTime=game.time;
	object2.inToxic=true;
	return false;
}

function collisionOnObtain_SWAMP(object1, object2, where)
{

	object2.lastInFluidTime=game.time;
	object2.inSwamp=true;
	return false;
}

function collisionOnObtain_LAVA(object1, object2, where)
{
	if (object2.moveable && game.time - object2.lastInFluidTime > 500)
	{
		var scale=Math.max(abs(object2.moveSpeed.x),abs(object2.moveSpeed.y))/800;
		if (scale>1) scale=1;
		if (scale>0.2)
		{
			scale*=0.85;
			var newObject = game.newObject(game.objectsDef["lava_splash"]);
			newObject.id = null;
			newObject.height=newObject.height * ((object2.width * (1-(object1.colliderRectangleOffset.left + object1.colliderRectangleOffset.right))) / newObject.width) * scale;
			newObject.width=object2.width * (1-(object1.colliderRectangleOffset.left + object1.colliderRectangleOffset.right)) * scale;
			
			newObject.position.x = object2.position.x + object2.width/2 - newObject.width/2;
			newObject.position.y = object1.position.y + object1.height * (1-object1.colliderRectangleOffset.top);
			game.addObject(newObject);
		}

	}

	object2.lastInFluidTime=game.time;
	object2.inLava=true;
	return false;
}

function collisionOnObtain_SAFEZONE(object1, object2, where)
{
	object2.inSafeZone=true;
	return false;
}

function collisionOnObtain_ARENAZONE(object1, object2, where)
{
	object2.inArenaZone=true;
	return false;
}

function collisionOnObtain_BATTLEROYALEZONE(object1, object2, where)
{
	object2.inBattleRoyaleZone=true;

	if ((emotesMenuOpened && object2==game.me) && game.me.userId!=1) 
	{
		hideEmotesMenu();
	}
	return false;
}


var brJoinMessageLastTime=0;

function collisionOnObtain_BATTLEROYALEPORTAL(object1, object2, where)
{
	if (!joinedGame || imDead) return false;
	if (object2!=game.me) return false;
	if (object1.animation!="active") return false;

	if (game.me.level<15) {textMsg(lang["battle_royale_min_level"],"red",1000); return false;}

	let joinTicketsCost = 20;
	let battleRoyalePromotionInfo = lang["battle_royale_grim_reaper_promotion_info"];

	if (game.time - brJoinMessageLastTime > 1000) 
	{
		if (document.getElementById('br-join-popup')) return;

		// Create the popup overlay
		let popupOverlay = document.createElement('div');
		popupOverlay.style.position = 'fixed';
		popupOverlay.style.top = '0';
		popupOverlay.style.left = '0';
		popupOverlay.style.width = '100vw';
		popupOverlay.style.height = '100vh';
		popupOverlay.style.background = 'rgba(0,0,0,0.5)';
		popupOverlay.style.display = 'flex';
		popupOverlay.style.alignItems = 'center';
		popupOverlay.style.justifyContent = 'center';
		popupOverlay.style.zIndex = '9999';

		// Create the popup box
		let popupBox = document.createElement('div');
		popupBox.id = 'br-join-popup';
		popupBox.style.background = '#fff';
		popupBox.style.padding = '32px 24px';
		popupBox.style.borderRadius = '12px';
		popupBox.style.boxShadow = '0 2px 16px rgba(0,0,0,0.2)';
		popupBox.style.textAlign = 'center';
		popupBox.style.minWidth = '320px';

		// Question text
		let question = document.createElement('div');
		question.innerHTML = getTranslation("ask_join_battle_royale",String(joinTicketsCost));
		if (game.me.name!="grimReaper")
			question.innerHTML += "<br><span style='display:block;margin-top:10px;font-size:14px;color:red;'>"+battleRoyalePromotionInfo+"</span>";
		if (typeof partyState!="undefined" && partyState.party)
			question.innerHTML += "<br><span style='display:block;margin-top:10px;font-size:14px;color:#b34b4b;'>"+getTranslation("battle_royale_leave_party_warning")+"</span>";
		question.style.marginBottom = '24px';
		question.style.fontSize = '18px';
		question.style.color = '#222';

		// Yes button
		let yesBtn = document.createElement('button');
		yesBtn.textContent = capitalizeFirstLetter(lang["yes"]);
		yesBtn.style.margin = '0 12px';
		yesBtn.style.padding = '8px 24px';
		yesBtn.style.fontSize = '16px';
		yesBtn.style.background = '#28a745';
		yesBtn.style.color = '#fff';
		yesBtn.style.border = 'none';
		yesBtn.style.borderRadius = '6px';
		yesBtn.style.cursor = 'pointer';

		// No button
		let noBtn = document.createElement('button');
		noBtn.textContent = capitalizeFirstLetter(lang["no"]);
		noBtn.style.margin = '0 12px';
		noBtn.style.padding = '8px 24px';
		noBtn.style.fontSize = '16px';
		noBtn.style.background = '#dc3545';
		noBtn.style.color = '#fff';
		noBtn.style.border = 'none';
		noBtn.style.borderRadius = '6px';
		noBtn.style.cursor = 'pointer';

		// Button actions
		yesBtn.onclick = function() {
			popupOverlay.remove();
			// Emit join event or handle logic here
			gameServer.emit('game:joinBR');

			//+ 5 min
			brJoinMessageLastTime=game.time+5000;
		};
		noBtn.onclick = function() {
			popupOverlay.remove();
		};

		// Assemble popup
		popupBox.appendChild(question);
		popupBox.appendChild(yesBtn);
		popupBox.appendChild(noBtn);
		popupOverlay.appendChild(popupBox);
		document.body.appendChild(popupOverlay);

	}
	brJoinMessageLastTime = Math.max(brJoinMessageLastTime, game.time);

	return false;
}


function collisionOnObtain_GEM(object1, object2, where)
{
	return false;
}

function collisionOnObtain_POTION(object1, object2, where)
{
	return false;
}

function collisionOnObtain_PARCHMENTINFO(object1, object2, where) {
	let infoId = object1.customData;

	if (object2 != game.me) return false;
	if (!infoId) return false;
	if (imDead) return false;

	if (object1.requestTime && game.time - object1.requestTime < 1000) return false;
	if (document.getElementById('parchment-info-popup')) return false;

	if (object1._parchmentMustBeAway) {
		if (!object1._parchmentLastCollisionTime) {
			object1._parchmentLastCollisionTime = game.time;
			return false;
		}
		if (game.time - object1._parchmentLastCollisionTime >= 2000) {
			object1._parchmentMustBeAway = false;
			object1._parchmentLastCollisionTime = null;
		} else {
			object1._parchmentLastCollisionTime = game.time;
			return false;
		}
	}

	if (object1._parchmentActive) {
		object1._parchmentLastTouch = game.time;
		return false;
	}

	object1._parchmentActive = true;
	object1._parchmentStart = game.time;
	object1._parchmentLastTouch = game.time;

	const REQUIRED_MS = 2300;
	const CHECK_INTERVAL = REQUIRED_MS / 100;

	// --- Popup + iframe przygotowany od razu (ukryty) ---
	let overlay2 = document.createElement('div');
	overlay2.id = 'parchment-info-overlay';
	Object.assign(overlay2.style, {
		position: 'fixed',
		inset: '0',
		display: 'none',
		alignItems: 'center',
		justifyContent: 'center',
		background: 'rgba(0,0,0,0.6)',
		zIndex: '10000',
		padding: '20px'
	});

	let box2 = document.createElement('div');
	box2.id = 'parchment-info-popup';
	Object.assign(box2.style, {
		background: '#fff',
		color: '#111',
		fontFamily: 'inherit',
		fontSize: '16px',
		lineHeight: '1.45',
		maxWidth: '1000px',
		width: '90%',
		maxHeight: '90vh',
		overflow: 'hidden',
		padding: '0',
		borderRadius: '12px',
		boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
		position: 'relative',
		display: 'flex',
		flexDirection: 'column',
		transform: 'scale(0.96)',
		opacity: '0',
		transition: 'all 0.3s ease-out'
	});

	let closeBtn = document.createElement('button');
	closeBtn.textContent = 'x';
	Object.assign(closeBtn.style, {
		position: 'absolute',
		right: '5px',
		top: '0px',
		background: 'transparent',
		border: 'none',
		color: '#ff1515',
		fontSize: '34px',
		cursor: 'pointer',
		lineHeight: '1',
		zIndex: '10001',
		textShadow: '-1px -1px 2px rgba(0,0,0,0.8), 0 -1px 2px rgba(0,0,0,0.8), 1px -1px 2px rgba(0,0,0,0.8), 1px 0 2px rgba(0,0,0,0.8), 1px 1px 2px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.8), -1px 1px 2px rgba(0,0,0,0.8), -1px 0 2px rgba(0,0,0,0.8)'
	
	});

	let iframe = document.createElement('iframe');
	iframe.id = 'parchment-info-iframe';
	iframe.src = siteUrl + '/api/parchment-info/' + encodeURIComponent(infoId) + '?lang=' + userLang +'&cdn=' + encodeURIComponent(cdnServer) + (partner=="crazygames"?'&partner=crazygames':'');
	Object.assign(iframe.style, {
		width: '100%',
		height: '80vh',
		border: 'none',
		borderRadius: '8px',
		background: '#f0e7d1',
		flex: '1 1 auto'
	});
	iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-autoplay');
	iframe.setAttribute('allow', 'autoplay');

	box2.appendChild(closeBtn);
	box2.appendChild(iframe);
	overlay2.appendChild(box2);
	document.body.appendChild(overlay2);

	function closeAndBlock() {
		if (overlay2 && overlay2.parentNode) overlay2.parentNode.removeChild(overlay2);
		object1._parchmentMustBeAway = true;
		object1._parchmentLastCollisionTime = game.time;
		object1._parchmentAwaySince = null;
		document.removeEventListener('keydown', onKey);
	}
	closeBtn.onclick = closeAndBlock;

	function onKey(e) {
		if (e.key === 'Escape') closeAndBlock();
	}
	document.addEventListener('keydown', onKey);

	overlay2.addEventListener('click', e => {
		if (e.target === overlay2) closeAndBlock();
	});

	// --- 🌀 Ładny efekt ładowania z pierścieniem postępu ---
	let overlay = document.createElement('div');
	overlay.id = 'parchment-progress-overlay';
	Object.assign(overlay.style, {
		position: 'fixed',
		inset: '0',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		background: 'radial-gradient(circle at center, rgba(255,255,240,0.25), rgba(0,0,0,0.4))',
		zIndex: '10000',
		backdropFilter: 'blur(3px)',
		pointerEvents: 'none',
		animation: 'pulseBg 2.4s ease-in-out infinite'
	});

	// SVG pierścień postępu
	let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 100 100');
	Object.assign(svg.style, {
		width: '120px',
		height: '120px',
		transform: 'rotate(-90deg)'
	});

	let defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
	let grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
	grad.setAttribute('id', 'goldGradient');
	grad.setAttribute('x1', '0%');
	grad.setAttribute('y1', '0%');
	grad.setAttribute('x2', '100%');
	grad.setAttribute('y2', '0%');

	let stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
	stop1.setAttribute('offset', '0%');
	stop1.setAttribute('stop-color', '#f6d365');
	let stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
	stop2.setAttribute('offset', '100%');
	stop2.setAttribute('stop-color', '#fda085');

	grad.appendChild(stop1);
	grad.appendChild(stop2);
	defs.appendChild(grad);
	svg.appendChild(defs);

	let bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	bgCircle.setAttribute('cx', '50');
	bgCircle.setAttribute('cy', '50');
	bgCircle.setAttribute('r', '42');
	Object.assign(bgCircle.style, {
		fill: 'none',
		stroke: 'rgba(255,255,200,0.15)',
		strokeWidth: '6'
	});

	let progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	progressCircle.setAttribute('cx', '50');
	progressCircle.setAttribute('cy', '50');
	progressCircle.setAttribute('r', '42');
	Object.assign(progressCircle.style, {
		fill: 'none',
		stroke: 'url(#goldGradient)',
		strokeWidth: '6',
		strokeLinecap: 'round',
		strokeDasharray: 2 * Math.PI * 42,
		strokeDashoffset: 2 * Math.PI * 42,
		filter: 'drop-shadow(0 0 6px rgba(255,200,80,0.8))'
	});

	svg.appendChild(bgCircle);
	svg.appendChild(progressCircle);

	let glow = document.createElement('div');
	Object.assign(glow.style, {
		position: 'absolute',
		inset: '10px',
		borderRadius: '50%',
		background: 'radial-gradient(circle, rgba(255,255,220,0.6), rgba(255,255,200,0.0))',
		filter: 'blur(8px)',
		animation: 'pulseGlow 1.5s ease-in-out infinite'
	});

	let wrapper = document.createElement('div');
Object.assign(wrapper.style, {
	position: 'relative',
	display: 'flex',
	flexDirection: 'column',
	alignItems: 'center',
	gap: '10px',
	width: '120px'
});

let ringWrapper = document.createElement('div');
Object.assign(ringWrapper.style, {
	position: 'relative',
	width: '120px',
	height: '120px'
});
ringWrapper.appendChild(glow);
ringWrapper.appendChild(svg);

let text = document.createElement('div');
text.textContent = lang["reading_parchment"];
Object.assign(text.style, {
	fontSize: '14px',
	color: '#fef7d1',
	textShadow: '0 0 6px rgba(0,0,0,0.8)',
	fontFamily: 'serif',
	letterSpacing: '0.5px',
	textAlign: 'center'
});

wrapper.appendChild(ringWrapper);
wrapper.appendChild(text);
overlay.appendChild(wrapper);

	document.body.appendChild(overlay);

	// CSS animacje (dodawane raz)
	if (!document.getElementById('parchment-pretty-styles')) {
		let style = document.createElement('style');
		style.id = 'parchment-pretty-styles';
		style.textContent = `
			@keyframes pulseGlow { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; transform: scale(1.05); } }
			@keyframes pulseBg { 0%, 100% { opacity: 1; } 50% { opacity: 0.85; } }
			@keyframes fadeOut { to { opacity: 0; transform: scale(1.1); } }
			@keyframes fadeIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
		`;
		document.head.appendChild(style);
	}

	// Progres animacji
	const CIRC = 2 * Math.PI * 42;
	let progressAnim = setInterval(() => {
		let elapsed = game.time - object1._parchmentStart;
		let progress = Math.min(elapsed / REQUIRED_MS, 1);
		progressCircle.style.strokeDashoffset = CIRC * (1 - progress);
	}, 30);

	let interval = setInterval(() => {
		if (!game.isCollision2Rectangles(object1, game.me)) {
			cleanup(false);
			return;
		}
		let elapsed = game.time - object1._parchmentStart;
		if (elapsed >= REQUIRED_MS) cleanup(true);
	}, CHECK_INTERVAL);

	function cleanup(showPopup) {
		clearInterval(interval);
		clearInterval(progressAnim);
		if (!overlay) return;
		overlay.style.animation = 'fadeOut 0.5s ease forwards';
		setTimeout(() => {
			if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
		}, 500);

		object1._parchmentActive = false;
		object1.requestTime = game.time;

		if (!showPopup) {
			if (overlay2 && overlay2.parentNode) overlay2.parentNode.removeChild(overlay2);
			return;
		}

		// 🟢 Pokaż popup z ładnym fade-in
		overlay2.style.display = 'flex';
		setTimeout(() => {
			box2.style.opacity = '1';
			box2.style.transform = 'scale(1)';
		}, 10);
	}

	return false;
}



function objectOnScreenHandlerFunc_POTION(object)
{
object.position.y = object.originalPosition.y + Math.sin(game.time / 500) * 4;
}

function objectOnScreenHandlerFunc_PARCHMENTINFO(object)
{
object.position.y = object.originalPosition.y + Math.sin(game.time / 500) * 4;
}

function objectOnScreenHandlerFunc_EASTEREGG(object) {


			if (!object.jumpStartTime) {
				object.jumpStartTime = game.time;
			}

			const timeSinceLastJump = (game.time - object.jumpStartTime) % 1200;
			const jumpProgress = timeSinceLastJump / 400;

			if (timeSinceLastJump < 400) {
				const jumpHeight = 5;
				object.position.y = object.originalPosition.y + Math.sin(jumpProgress * Math.PI) * jumpHeight;
				
				// Add shaking effect during jump
				const shakeAmount = Math.sin(jumpProgress * Math.PI * 2) * 10;
				object.rotation = shakeAmount;
			}


}

function collisionOnObtain_IGNOREFOOD(object1, object2, where)
{
if (object1.hasSoul && object2.throwable)
	return true;

if (checkFoodChain(object2,object1).check==0 || object2.eatsSouls)
return false;
}

function collisionOnObtain_SPIDERWEB(object1, object2, where)
{
	if (object2.name!='blackWidow' && object2.name!='fireball' && object2.name!='plasmaball' && object2.name!='spiderweb_throwable')
	{
	if (abs(object2.moveSpeed.x)>50)
	object2.moveSpeed.x*=0.8;
	if (abs(object2.moveSpeed.y)>50)
	object2.moveSpeed.y*=0.8;
	}
	return false;
}

function objectHandlerFunc_LOCKMOVESPEEDX(object)
{
//if (object.moveDirection==0) return;

if (object.groundedBottom && abs(object.moveSpeed.x)<object.lockSpeedX)
object.moveSpeed.x=object.lockSpeedX*object.moveDirection;
}

function collisionOnObtain_HIDE(object1, object2, where)
{
	if (object2.type==objectType.PLAYER)
	{
		/*if (object2.inHideId!=object1.id)
		{
			object2.moveSpeed.x=0;
			object2.moveSpeed.y=0;
			object2.inHideId=object1.id;
			object2.inHide=true;
			object2.inHideTime=game.time;
		}*/
		return false;
	}
}

function collisionOnObtain_SPACEBOTTOM(object1, object2, where)
{
	var scale=object1.height/((object1.position.y+object1.height)-object2.position.y);
	scale*=10;
	if (scale>100)
	scale=100;
		
	object2.inSpace=true;
	object2.inSpaceScale=scale;

return false;
}

function collisionOnObtain_SPACE(object1, object2, where)
{
	object2.inSpace=true;
	object2.inSpaceScale=100;

	return false;
}

function collisionOnTrigger_SAW(object1, object2, where)
{
	if (!object2.moveable) return false;
}


function collisionOnTrigger_PIG(object1, object2, where)
		{
			if (where==game.collisionOn.BOTTOM)
			{
				if (object1.moveRangeX!=null)
					{
						var speedX=100;
						var speedY=380;
						
						var possibleJumpLength=speedX*(speedY/game.gravity);
		
						if (object1.position.x<=object1.moveRangeX.from+possibleJumpLength)
						object1.moveSpeed.x=speedX;
						else if (object1.position.x>=object1.moveRangeX.to-object1.width-possibleJumpLength)
						object1.moveSpeed.x=-speedX;
						else if(abs(object1.moveSpeed.x)!=speedX)
						object1.moveSpeed.x=speedX*((object1.moveSpeed.x>=0)?1:-1);	
					
						object1.moveSpeed.y=speedY;
					
					}
				
			
				
			}/*else 
				if (object2.type!=objectType.TILE)	
				return false;*/
			
			
		}

function collisionOnObtain_TELEPORT(object1, object2, where)	
{
	return false;
		if (object2.type!=objectType.PLAYER && object2.type!=objectType.FOOD) return false;

		if (object2.moveable)
		{
			object2.moveSpeed.x=0;
			object2.moveSpeed.y=0;
			return false;
		}
}

function collisionOnTrigger_PLAYER(object1,object2,where)
{
	if ((object1.grabbedById!=null && object1.grabbedById==object2.id) || (object2.grabbedById!=null && object2.grabbedById==object1.id))
		return false;

	if (object2.type==objectType.PLAYER && object2.inHide)
		return false;

	if (shouldPlayerIgnoreImmortalCollision(object1,object2))
		return false;

	if (object1.eatsSouls && object2.reapersIgnoreCollision) return false;
		
	if (object2.type==objectType.FOOD && object2.name=="zombie" && (object1.eatsSouls || object1.name=="pumpkinCharacter")) return false;

	if ((object1.inSafeZone || object2.inSafeZone) && object2.type==objectType.PLAYER) return false;
	
	
	if (object2.type==objectType.TILE && object1.ignoreTiles>0)
		return false;

	if (object1.skill)
		if (object1.skill.event==skillEvent.onCollideTrigger)
			object1.skill.func(object1,object2);

	if ((object1.eatsSouls || object1.name=="pumpkinCharacter") && object2.name=="zombie") return false;

	if ((object1.name=='pigeon' || object1.name=='hen') && where == game.collisionOn.BOTTOM)
	{
		if (object1.animation == "flying_left" || object1.animation == "flapping_left")
				object1.animation = "standing_left";
			else if(object1.animation == "flying_right" || object1.animation == "flapping_right")
				object1.animation = "standing_right";

		if (object1.animation == "standing_left" || object1.animation == "standing_right")
		  if (object1.flySide==-1)
			  object1.animation = "standing_left";
			else if (object1.flySide==1)
				object1.animation = "standing_right";
	}
}

function shouldPlayerIgnoreImmortalCollision(object1,object2)
{
	if (!(object2.immortal || object1.immortal)) return false;
	if (!(object2.type==objectType.PLAYER || object2.type==objectType.FOOD || object2.type==objectType.BOSS || object2.name=="bomb")) return false;
	if (object2.name=="flower_1_face_on_red" || object2.name=="cosmicPlant") return false;
	if (object2.name=="boss1" && object2.immortal===true && object1.immortal!==true) return false;

	return true;
}

function collisionOnObtain_PLAYER(object1, object2, where)
{
	if ((object1.grabbedById!=null && object1.grabbedById==object2.id) || (object2.grabbedById!=null && object2.grabbedById==object1.id))
		return false;

	if (object1.immortal) return false;
	if (object2.type==objectType.FOOD && object2.name=="zombie" && (object1.eatsSouls || object1.name=="pumpkinCharacter")) return false;
	if ((object1.inSafeZone || object2.inSafeZone) && object2.type==objectType.PLAYER) return false;
	if (object1.eatsSouls && object2.reapersIgnoreCollision) return false;
}

function collisionOnTrigger_IGNOREFOOD(object1, object2, where)
{
if (object2.type==objectType.FOOD && !object2.moveable)
	{
		return false;
	}
}

function collision_BOSS1BAT(object1, object2, where)
{
	if ((object1.name=="boss1Bat" && object2.name=="boss1") || (object2.name=="boss1Bat" && object1.name=="boss1"))
		return false;
}

function collisionOnObtainTrigger_FIREBALL(object1, object2, where)
{
return false;
}

function collisionOnTrigger_TOMBSTONE(object1, object2, where)
{
if (object2.moveable)
return false;


if (object1.startedAnimation!=true && where == game.collisionOn.BOTTOM && object1.moveSpeed.y<=0 && object1.animations["start"])
if (game.objectsDef[object1.name].lazySpritesLoaded)
{
	object1.startedAnimation=true;
	object1.animationFrame=0;
	object1.animation="start";
}

}


function collisionOnObtain_TOMBSTONE(object1, object2, where)
{
if (object2.moveable)
return false;
}


//SKILLS

game.skills.flowerLove.func=skill_FLOWERLOVE;

function skill_FLOWERLOVE(object1, object2)
{
    if (object2.name=="flower_1_face_on_red")
    {
		object1.invisibleTime=game.time+100;
		return true;
    }

return true;
}

function collisionOnObtain_ECTOPLASM(object1, object2, where)
{
	object2.inEctoplasm=true;
	return false;
}


function collisionOnObtain_WATERDROP(object1, object2, where)
{
	return false;
}

function collision_VOLLEYBALL(object1, object2, where)
{
if (object2.type==objectType.PLAYER)
if (object2.name!="grimReaper" && object2.name!="ghostlyReaper" && object2.name!="pumpkinGhost")
return false;
}

function collision_SHURIKEN(object1, object2, where)
{
if (object1.customData==object2.id) return false;
if (object2.name=="shuriken") return false;

if (object2.type==objectType.PLAYER || (object2.type==objectType.FOOD && object2.moveable))
	if (abs(object1.moveSpeed.x)<60 && abs(object1.moveSpeed.y)<60 || object1.customData==object2.id || object1.customData==null)
		return false;


if (object2.type==objectType.PLAYER && object1.customData==null)
	return false;

return true;
}

function collision_SPIDERWEB(object1, object2, where)
{
	if (object1.customData!=null || object2.throwable || object2.type==objectType.PLAYER || (object2.type==objectType.FOOD && object2.moveable))
		return false;
}

function collision_GEM_MOVEABLE(object1, object2, where)
{
if (object1.customData==object2.id) return false;
if (object2.throwable) return false;

if (object2.type==objectType.PLAYER)
	return false;

return true;
}

collision_SNOWBALL=function(object1, object2, where)
{
if (object1.customData==object2.id) return false;
if (object2.throwable) return false;

if (object2.type==objectType.PLAYER || (object2.type==objectType.FOOD && object2.moveable))
	if (object1.customData==null)
		return false;


if (object2.type==objectType.PLAYER && object1.customData==null)
	return false;

object1.moveSpeed.x*=0.5;
object1.moveSpeed.y*=0.5;

return true;
}

function objectOnScreenHandlerFunc_LAVA(object)
{

if (object.cantSpawnBubble==true) 
	{
		return;
	}
/*
	var objects=game.hashMap.retrieve(object);
	for (var i=0;i<objects.length;i++)
	{
		var obj=objects[i];
		if (object.name=="lava_bubble")
			if (game.isCollision2Rectangles(object,obj))
			{
				game.deleteObject(object);
			}
	} 
*/

if (randomInteger(1,20)==1)
{
	//spawn lava_bubble
	var newObject = game.newObject(game.objectsDef["lava_bubble"]);
	newObject.id = null;
	newObject.position.x = object.position.x+object.width/2 - newObject.width/2 + 3;
	newObject.position.y = object.position.y+object.height - 1;

	//check if new object is not inside another tile object
	var objects=game.hashMap.retrieve(newObject);
	for (var i=0;i<objects.length;i++)
	{
		var obj=objects[i];
		if (object.type==objectType.TILE && obj!=object)
		{
			if (game.isCollision2Rectangles(newObject,obj))
			{
				if (object.moveable==false)
					object.cantSpawnBubble=true;

				return;
			}
		}
	}

	game.addObject(newObject);
	
}


}
