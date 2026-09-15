/* global THREE , ATUtil , StarShader, noise */


/*
	Stars
	variable size white points
*/

var Stars= function(){

	var scope = this;
	var NUM_STARS = 10000;
	var RANGE = 1000;
	var noiseScale = 0.002;
	var OPACITY = 0.4;

	this.init = function(parent){
		//custom dots with size determined by noise
		var dotMaterial = new THREE.ShaderMaterial( {
				uniforms: 		THREE.UniformsUtils.clone( StarShader.uniforms ),
				vertexShader:  	StarShader.vertexShader,
				fragmentShader: StarShader.fragmentShader,
				transparent: true,
				depthWrite:false,
				blending: THREE.AdditiveBlending
		});
		
		
		var glowGeo = new THREE.BufferGeometry();
		scope.sunGlowMaterial = new THREE.ShaderMaterial({
				//map: sunCoronaTexture,
				uniforms: 		THREE.UniformsUtils.clone( CustomStarShader.uniforms),
				blending: THREE.AdditiveBlending,
				fragmentShader: CustomStarShader.fragmentShader,
				vertexShader:   CustomStarShader.vertexShader,
				transparent: true,
				color: 0xffffff,
				//	settings that prevent z fighting
				//polygonOffset: true,
				//polygonOffsetFactor: -1,
				//polygonOffsetUnits: 100,
				depthWrite: false
			}
		);
		scope.sunGlowMaterial.uniforms.texturePrimary.value = new THREE.TextureLoader().load('./js/corona.png');
		scope.sunGlowMaterial.uniforms.textureSpectral.value = new THREE.TextureLoader().load('./js/star_colorshift.png');

		dotMaterial.uniforms.texture.value = new THREE.TextureLoader().load( './js/dot.png' );
		var dotGeometry = new THREE.BufferGeometry();

		var position = new Float32Array( NUM_STARS * 3);
		var size = new Float32Array( NUM_STARS );
		var opacity = new Float32Array( NUM_STARS );
		
		var position2 = new Float32Array( NUM_STARS * 3);
		var size2 = new Float32Array( NUM_STARS );
		var opacity2 = new Float32Array( NUM_STARS );

		//position dots + set size
		for ( var i = 0; i < NUM_STARS; i ++ ) {

			var pos = ATUtil.randomVector3(RANGE);
			pos.toArray( position, i * 3 );
			pos.toArray(position2, i * 3);
			//glowGeo.vertices.push(pos);

			//clump size of dots
			var n = (noise.noise3d(pos.x * noiseScale, pos.y * noiseScale, pos.z * noiseScale) + 1 ) /2;
			n = Math.pow(n,3);
			
			var sizee = ATUtil.lerp(n, 2 , 20);
			size[i] = sizee;
			size2[i] = sizee * 5;
			
			var opacitye = Math.random() * OPACITY;
			opacity[ i ] = opacitye;
			opacity2[i] = opacitye;
		}

		dotGeometry.addAttribute( 'position', new THREE.BufferAttribute( position, 3 ) );
		dotGeometry.addAttribute( 'size', new THREE.BufferAttribute( size, 1 ));
		dotGeometry.addAttribute( 'opacity', new THREE.BufferAttribute( opacity, 1 ));
		
		glowGeo.addAttribute( 'position', new THREE.BufferAttribute( position2, 3 ) );
		glowGeo.addAttribute( 'size', new THREE.BufferAttribute( size2, 1 ));
		glowGeo.addAttribute( 'opacity', new THREE.BufferAttribute( opacity2, 1 ));
		
		scope.dots = new THREE.Points( dotGeometry, dotMaterial);
		scope.glow = new THREE.Points(glowGeo, scope.sunGlowMaterial);

		//scope.glow.rotation.x = Math.random() * 6;
		//scope.glow.rotation.y = Math.random() * 6;
		//scope.glow.rotation.z = Math.random() * 6;
		
		scope.holder = new THREE.Object3D();
		scope.holder.add(scope.dots);
		scope.holder.add(scope.glow);
		parent.add(scope.holder);

		
	};

};
